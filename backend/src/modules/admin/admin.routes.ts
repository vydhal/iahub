import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../shared/audit/audit.js';
import { MODULE_KEYS, MODULES, modulesOf, normalizeModules } from '../../shared/modules/catalog.js';
import { requireSuperadmin } from '../../shared/tenancy/tenant.js';
import { ensureSubscription } from '../billing/billing.engine.js';
import { platformSettings, saveLogo } from '../platform/platform.routes.js';
import { MEDIA_DIR } from '../media/media.routes.js';
import { rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Administração da plataforma (Simplisoft). Cada cliente é uma conta: o superadmin cria o acesso,
 * liga/desliga módulos, define limites, suspende e reativa a assinatura e gere os usuários.
 */
export async function adminRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: [fastify.authenticate, requireSuperadmin] };

  fastify.get('/catalog', guard, async (_request, reply) => {
    const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    return reply.send({ modules: MODULES, plans });
  });

  fastify.get('/accounts', guard, async (_request, reply) => {
    const workspaces = await prisma.workspace.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { members: true, brands: true, agents: true, carousels: true, scheduledPosts: true } },
      },
    });
    const accounts = await Promise.all(
      workspaces.map(async (w) => {
        const [lastExecution, openInvoices] = await Promise.all([
          prisma.agentExecution.findFirst({ where: { workspaceId: w.id }, orderBy: { queuedAt: 'desc' }, select: { queuedAt: true, status: true } }),
          prisma.invoice.count({ where: { workspaceId: w.id, status: { in: ['open', 'overdue'] } } }),
        ]);
        return {
          id: w.id,
          name: w.name,
          slug: w.slug,
          status: w.status,
          suspendedAt: w.suspendedAt,
          suspendedReason: w.suspendedReason,
          contactEmail: w.contactEmail,
          notes: w.notes,
          plan: w.subscription?.plan?.name || w.plan,
          planCode: w.subscription?.plan?.code || null,
          creditsUsed: w.creditsUsed,
          creditsTotal: w.creditsTotal,
          maxBrands: w.maxBrands,
          maxScheduledPosts: w.maxScheduledPosts,
          modules: modulesOf(w),
          counts: w._count,
          lastExecution,
          openInvoices,
          createdAt: w.createdAt,
        };
      }),
    );
    return reply.send(accounts);
  });

  fastify.get('/accounts/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: { subscription: { include: { plan: true } }, members: { include: { user: { select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true } } } } },
    });
    if (!workspace) return reply.status(404).send({ message: 'Conta não encontrada' });
    const [invoices, usage] = await Promise.all([
      prisma.invoice.findMany({ where: { workspaceId: id }, orderBy: { createdAt: 'desc' }, take: 12 }),
      prisma.usageRecord.aggregate({ where: { workspaceId: id }, _sum: { estimatedCost: true, tokensInput: true, tokensOutput: true } }),
    ]);
    return reply.send({
      ...workspace,
      modules: modulesOf(workspace),
      users: workspace.members.map((m) => ({ ...m.user, memberRole: m.role })),
      invoices,
      usage: { cost: usage._sum.estimatedCost || 0, tokens: (usage._sum.tokensInput || 0) + (usage._sum.tokensOutput || 0) },
    });
  });

  // Cria a conta do cliente + usuário de acesso. É o fluxo "cliente adquiriu, entregue o acesso".
  fastify.post('/accounts', guard, async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(2),
        ownerName: z.string().min(2),
        ownerEmail: z.string().email(),
        ownerPassword: z.string().min(6),
        planCode: z.string().optional(),
        modules: z.record(z.boolean()).optional(),
        maxBrands: z.number().int().min(0).max(500).optional(),
        maxScheduledPosts: z.number().int().min(0).max(5000).optional(),
        notes: z.string().max(2000).optional(),
      })
      .parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: body.ownerEmail } });
    if (existing) return reply.status(409).send({ message: 'Já existe um usuário com esse e-mail.' });

    const plan = body.planCode ? await prisma.plan.findUnique({ where: { code: body.planCode } }) : null;
    if (body.planCode && !plan) return reply.status(404).send({ message: 'Plano não encontrado' });

    const modules = body.modules
      ? normalizeModules(body.modules)
      : normalizeModules(Object.fromEntries((plan?.modules || []).map((m) => [m, true])));

    const workspace = await prisma.workspace.create({
      data: {
        name: body.name,
        slug: `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}-${Date.now().toString().slice(-4)}`,
        plan: plan?.name || 'Essencial',
        creditsTotal: plan?.creditsIncluded ?? 1000,
        maxBrands: body.maxBrands ?? plan?.maxBrands ?? 3,
        maxScheduledPosts: body.maxScheduledPosts ?? plan?.maxScheduledPosts ?? 100,
        modules: modules as any,
        contactEmail: body.ownerEmail,
        notes: body.notes,
        members: {
          create: {
            role: 'OWNER',
            user: { create: { name: body.ownerName, email: body.ownerEmail, passwordHash: await bcrypt.hash(body.ownerPassword, 10), role: 'ADMIN' } },
          },
        },
      },
    });

    if (plan) {
      const sub = await ensureSubscription(workspace.id);
      await prisma.subscription.update({ where: { id: sub.id }, data: { planId: plan.id } });
    }
    await audit(workspace.id, (request.user as any).id, 'admin.account_create', 'workspace', workspace.id, { name: workspace.name, plan: plan?.code, modules });
    return reply.status(201).send(workspace);
  });

  fastify.patch('/accounts/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        name: z.string().min(2).optional(),
        planCode: z.string().optional(),
        modules: z.record(z.boolean()).optional(),
        maxBrands: z.number().int().min(0).max(500).optional(),
        maxScheduledPosts: z.number().int().min(0).max(5000).optional(),
        creditsTotal: z.number().int().min(0).optional(),
        contactEmail: z.string().email().optional(),
        notes: z.string().max(2000).optional(),
      })
      .parse(request.body);

    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace) return reply.status(404).send({ message: 'Conta não encontrada' });

    let planName: string | undefined;
    if (body.planCode) {
      const plan = await prisma.plan.findUnique({ where: { code: body.planCode } });
      if (!plan) return reply.status(404).send({ message: 'Plano não encontrado' });
      planName = plan.name;
      const sub = await ensureSubscription(id);
      await prisma.subscription.update({ where: { id: sub.id }, data: { planId: plan.id } });
    }

    const updated = await prisma.workspace.update({
      where: { id },
      data: {
        name: body.name,
        plan: planName,
        modules: body.modules ? (normalizeModules(body.modules) as any) : undefined,
        maxBrands: body.maxBrands,
        maxScheduledPosts: body.maxScheduledPosts,
        creditsTotal: body.creditsTotal,
        contactEmail: body.contactEmail,
        notes: body.notes,
      },
    });
    await audit(id, (request.user as any).id, 'admin.account_update', 'workspace', id, { fields: Object.keys(body) });
    return reply.send({ ...updated, modules: modulesOf(updated) });
  });

  fastify.post('/accounts/:id/suspend', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(request.body || {});
    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace) return reply.status(404).send({ message: 'Conta não encontrada' });

    const updated = await prisma.workspace.update({
      where: { id },
      data: { status: 'suspended', suspendedAt: new Date(), suspendedReason: reason || null },
    });
    // Assinatura pausada e agendas dos agentes desligadas: conta suspensa não executa nada.
    await prisma.subscription.updateMany({ where: { workspaceId: id }, data: { status: 'paused' } });
    const agents = await prisma.agent.findMany({ where: { workspaceId: id, status: 'ACTIVE' } });
    const { syncAgentSchedule } = await import('../../agent-ops/queue.js');
    for (const agent of agents) {
      await prisma.agent.update({ where: { id: agent.id }, data: { status: 'PAUSED' } });
      await syncAgentSchedule({ ...agent, status: 'PAUSED' }).catch(() => {});
    }
    await audit(id, (request.user as any).id, 'admin.account_suspend', 'workspace', id, { reason, agentesPausados: agents.length });
    return reply.send({ ...updated, modules: modulesOf(updated), agentsPaused: agents.length });
  });

  fastify.post('/accounts/:id/reactivate', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace) return reply.status(404).send({ message: 'Conta não encontrada' });

    const updated = await prisma.workspace.update({
      where: { id },
      data: { status: 'active', suspendedAt: null, suspendedReason: null },
    });
    await prisma.subscription.updateMany({ where: { workspaceId: id }, data: { status: 'active' } });
    await audit(id, (request.user as any).id, 'admin.account_reactivate', 'workspace', id);
    // Os agentes voltam em PAUSED de propósito: quem opera decide o que religar.
    return reply.send({ ...updated, modules: modulesOf(updated) });
  });

  // ── Gestão de acesso ──
  fastify.post('/accounts/:id/users', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(6), role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).default('MEMBER') })
      .parse(request.body);
    const workspace = await prisma.workspace.findUnique({ where: { id } });
    if (!workspace) return reply.status(404).send({ message: 'Conta não encontrada' });
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      return reply.status(409).send({ message: 'Já existe um usuário com esse e-mail.' });
    }
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 10),
        role: body.role === 'MEMBER' ? 'USER' : 'ADMIN',
        memberships: { create: { workspaceId: id, role: body.role } },
      },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    await audit(id, (request.user as any).id, 'admin.user_create', 'user', user.id, { email: user.email, role: body.role });
    return reply.status(201).send(user);
  });

  fastify.patch('/users/:userId', guard, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = z.object({ active: z.boolean().optional(), password: z.string().min(6).optional(), name: z.string().min(2).optional() }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: true } });
    if (!user) return reply.status(404).send({ message: 'Usuário não encontrado' });
    if (user.role === 'SUPERADMIN' && body.active === false) {
      return reply.status(409).send({ message: 'Não é possível desativar a conta da administração da plataforma.' });
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        active: body.active,
        name: body.name,
        ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 10) } : {}),
      },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    const wsId = user.memberships[0]?.workspaceId;
    if (wsId) {
      await audit(wsId, (request.user as any).id, 'admin.user_update', 'user', userId, { active: body.active, senhaAlterada: !!body.password });
    }
    return reply.send(updated);
  });

  /**
   * Exclusão definitiva da conta do cliente. Exige o nome digitado como confirmação,
   * desliga agendas e remove os arquivos de mídia do disco (o banco cai em cascata).
   */
  fastify.delete('/accounts/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { confirmName } = z.object({ confirmName: z.string() }).parse(request.body || {});
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: { _count: { select: { members: true, brands: true, carousels: true, agents: true, scheduledPosts: true, invoices: true } } },
    });
    if (!workspace) return reply.status(404).send({ message: 'Conta não encontrada' });
    if (confirmName.trim() !== workspace.name) {
      return reply.status(400).send({ message: 'Digite o nome exato da conta para confirmar a exclusão.' });
    }

    // Desliga o que roda em segundo plano antes de apagar
    const { syncAgentSchedule } = await import('../../agent-ops/queue.js');
    const { cancelPostJob } = await import('../scheduler/scheduler.queue.js');
    const [agents, posts] = await Promise.all([
      prisma.agent.findMany({ where: { workspaceId: id } }),
      prisma.scheduledPost.findMany({ where: { workspaceId: id }, select: { id: true } }),
    ]);
    for (const agent of agents) await syncAgentSchedule({ ...agent, status: 'PAUSED' }).catch(() => {});
    for (const post of posts) await cancelPostJob(post.id).catch(() => {});

    // Registra antes de apagar: depois do delete o workspaceId não existe mais
    await audit(id, (request.user as any).id, 'admin.account_delete', 'workspace', id, {
      name: workspace.name,
      conteudo: workspace._count,
    });
    const usuarios = await prisma.user.findMany({
      where: { memberships: { every: { workspaceId: id } }, role: { not: 'SUPERADMIN' } },
      select: { id: true, email: true },
    });

    await prisma.workspace.delete({ where: { id } });
    // Usuários que só existiam nesta conta vão junto
    if (usuarios.length) await prisma.user.deleteMany({ where: { id: { in: usuarios.map((u) => u.id) } } });
    await rm(path.join(MEDIA_DIR, id), { recursive: true, force: true }).catch(() => {});

    return reply.send({ deleted: true, name: workspace.name, usuariosRemovidos: usuarios.length });
  });

  // ── Identidade da plataforma ──
  fastify.get('/branding', guard, async (_request, reply) => {
    return reply.send(await platformSettings());
  });

  fastify.put('/branding', guard, async (request, reply) => {
    const body = z
      .object({
        productName: z.string().min(1).max(60).optional(),
        tagline: z.string().max(60).optional(),
        loginHeadline: z.string().max(120).optional(),
        loginMessage: z.string().max(400).nullable().optional(),
        supportEmail: z.string().email().nullable().optional(),
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor em hexadecimal, ex: #17594E').optional(),
      })
      .parse(request.body);
    const saved = await prisma.platformSettings.upsert({ where: { id: 'singleton' }, update: body, create: { id: 'singleton', ...body } });
    await audit('singleton', (request.user as any).id, 'admin.branding_update', 'platform_settings', 'singleton', { fields: Object.keys(body) }).catch(() => {});
    return reply.send(saved);
  });

  fastify.post('/branding/logo', guard, async (request, reply) => {
    const file = await (request as any).file({ limits: { fileSize: 2 * 1024 * 1024 } });
    if (!file) return reply.status(400).send({ message: 'Envie um arquivo de imagem.' });
    try {
      const saved = await saveLogo(await file.toBuffer(), file.mimetype);
      return reply.send(saved);
    } catch (err: any) {
      return reply.status(400).send({ message: err.message });
    }
  });

  fastify.delete('/branding/logo', guard, async (_request, reply) => {
    const saved = await prisma.platformSettings.upsert({ where: { id: 'singleton' }, update: { logoPath: null }, create: { id: 'singleton' } });
    return reply.send(saved);
  });

  fastify.get('/metrics', guard, async (_request, reply) => {
    const [accounts, suspended, users, executions, openInvoices, revenue] = await Promise.all([
      prisma.workspace.count(),
      prisma.workspace.count({ where: { status: 'suspended' } }),
      prisma.user.count({ where: { active: true } }),
      prisma.agentExecution.count({ where: { queuedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
      prisma.invoice.aggregate({ where: { status: { in: ['open', 'overdue'] } }, _sum: { totalCents: true }, _count: { _all: true } }),
      prisma.invoice.aggregate({ where: { status: 'paid', paidAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _sum: { totalCents: true } }),
    ]);
    const byModule = await prisma.workspace.findMany({ select: { modules: true } });
    const moduleUsage = Object.fromEntries(
      MODULE_KEYS.map((k) => [k, byModule.filter((w) => modulesOf(w)[k]).length]),
    );
    return reply.send({
      accounts,
      suspended,
      users,
      executions30d: executions,
      openInvoices: { count: openInvoices._count._all, totalCents: openInvoices._sum.totalCents || 0 },
      revenue30dCents: revenue._sum.totalCents || 0,
      moduleUsage,
    });
  });
}
