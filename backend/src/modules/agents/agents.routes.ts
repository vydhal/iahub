import type { Agent } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { normalizeDomain } from '../../agent-ops/network.js';
import { providerCatalog, executionProviders } from '../../agent-ops/providers/index.js';
import { createAndEnqueue, cronFor, nextRunOf, syncAgentSchedule, validateCron } from '../../agent-ops/queue.js';
import { OPERATIONAL_TEMPLATES } from '../../agent-ops/templates.js';
import { toolCatalog, toolRegistry } from '../../agent-ops/tools/registry.js';
import { AUTONOMY_LEVELS, PlaybookSchema, SCHEDULE_TYPES } from '../../agent-ops/types.js';
import { audit } from '../../shared/audit/audit.js';
import { randomToken } from '../../shared/security/crypto.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

const AGENT_TYPES = ['STRATEGIST', 'COPYWRITER', 'ART_DIRECTOR', 'IMAGE_GENERATOR', 'CRITIC', 'REVIEWER', 'PROJECT_MANAGER'] as const;

function initialsFrom(name: string) {
  return name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'AG';
}

const ScheduleConfig = z
  .object({
    time: z.string().regex(/^\d{2}:\d{2}$/, 'horário no formato HH:mm').optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    cron: z.string().optional(),
  })
  .partial();

const AgentBody = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  type: z.enum(AGENT_TYPES).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  temperature: z.string().optional(),
  systemPrompt: z.string().default(''),
  tools: z.array(z.string()).optional(),
  niche: z.string().optional(),
  enabled: z.boolean().optional(),
  // operacionais
  kind: z.enum(['STUDIO', 'OPERATIONAL']).optional(),
  objective: z.string().nullable().optional(),
  executionProvider: z.string().optional(),
  autonomyLevel: z.enum(AUTONOMY_LEVELS).optional(),
  toolIds: z.array(z.string()).optional(),
  playbook: PlaybookSchema.nullable().optional(),
  allowedDomains: z.array(z.string()).optional(),
  scheduleType: z.enum(SCHEDULE_TYPES).optional(),
  scheduleConfig: ScheduleConfig.nullable().optional(),
  timezone: z.string().optional(),
  maxDurationSec: z.number().int().min(10).max(3600).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  maxActions: z.number().int().min(1).max(500).optional(),
  alertCredentialId: z.string().nullable().optional(),
  estimatedMinutesSaved: z.number().int().min(0).max(10_000).optional(),
});

/** Regras que tornam um agente operacional coerente antes de gravar. Lança Error com mensagem legível. */
async function validateOperational(workspaceId: string, data: Partial<z.infer<typeof AgentBody>>, current?: Agent) {
  const toolIds = data.toolIds ?? current?.toolIds ?? [];
  const unknown = toolIds.filter((t) => !toolRegistry.has(t));
  if (unknown.length) throw new Error(`Ferramentas desconhecidas: ${unknown.join(', ')}`);

  const playbook = data.playbook === undefined ? (current?.playbook as any) : data.playbook;
  if (playbook) {
    const parsed = PlaybookSchema.parse(playbook);
    const ids = new Set<string>();
    for (const step of parsed) {
      if (ids.has(step.id)) throw new Error(`Etapa duplicada no playbook: ${step.id}`);
      ids.add(step.id);
      if (!toolIds.includes(step.tool)) throw new Error(`A etapa "${step.label}" usa ${step.tool}, que não está liberada nas ferramentas do agente.`);
    }
  }

  const provider = data.executionProvider ?? current?.executionProvider;
  if (provider && !executionProviders.has(provider)) throw new Error(`Provedor de execução inválido: ${provider}`);

  if (data.alertCredentialId) {
    const cred = await prisma.credential.findFirst({ where: { id: data.alertCredentialId, workspaceId } });
    if (!cred) throw new Error('Credencial de alerta não pertence a este workspace.');
  }

  const probe = {
    scheduleType: data.scheduleType ?? current?.scheduleType ?? 'manual',
    scheduleConfig: (data.scheduleConfig === undefined ? current?.scheduleConfig : data.scheduleConfig) as any,
  };
  const expr = cronFor(probe as any);
  if (expr) validateCron(expr, data.timezone ?? current?.timezone ?? 'America/Sao_Paulo');
}

async function agentStats(workspaceId: string, agentIds: string[]) {
  if (!agentIds.length) return new Map<string, any>();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [grouped, last] = await Promise.all([
    prisma.agentExecution.groupBy({
      by: ['agentId', 'status'],
      where: { workspaceId, agentId: { in: agentIds }, sandbox: false, queuedAt: { gte: since } },
      _count: { _all: true },
      _sum: { cost: true },
    }),
    prisma.agentExecution.findMany({
      where: { workspaceId, agentId: { in: agentIds } },
      orderBy: { queuedAt: 'desc' },
      distinct: ['agentId'],
      select: { agentId: true, id: true, status: true, queuedAt: true, finishedAt: true, sandbox: true },
    }),
  ]);
  const map = new Map<string, any>();
  for (const id of agentIds) map.set(id, { completed: 0, failed: 0, total: 0, cost30d: 0, lastExecution: null });
  for (const g of grouped) {
    const s = map.get(g.agentId);
    s.total += g._count._all;
    s.cost30d += g._sum.cost || 0;
    if (g.status === 'completed') s.completed += g._count._all;
    if (g.status === 'failed') s.failed += g._count._all;
  }
  for (const l of last) map.get(l.agentId).lastExecution = l;
  for (const s of map.values()) {
    const finished = s.completed + s.failed;
    s.successRate = finished ? Math.round((s.completed / finished) * 100) : null;
  }
  return map;
}

function present(agent: Agent, stats?: any) {
  const { webhookToken, ...rest } = agent;
  return {
    ...rest,
    webhookUrl: webhookToken ? `/api/hooks/agents/${webhookToken}` : null,
    nextRunAt: nextRunOf(agent),
    stats: stats ?? null,
  };
}

async function findOwned(workspaceId: string, id: string) {
  return prisma.agent.findFirst({ where: { id, workspaceId } });
}

export async function agentRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('agentes') };

  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const agents = await prisma.agent.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    const stats = await agentStats(workspaceId, agents.filter((a) => a.kind === 'OPERATIONAL').map((a) => a.id));
    return reply.send(agents.map((a) => present(a, stats.get(a.id))));
  });

  // Catálogos para o wizard de criação
  fastify.get('/catalog', guard, async (request, reply) => {
    return reply.send({
      tools: toolCatalog(),
      templates: OPERATIONAL_TEMPLATES,
      executionProviders: providerCatalog(),
      autonomyLevels: [
        { id: 'READ_ONLY', label: 'Somente leitura', description: 'Consulta e analisa. Não entrega nem altera nada — resultado fica no painel.' },
        { id: 'RECOMMEND', label: 'Recomendação', description: 'Entrega relatórios aos canais internos; ações que alteram dados viram sugestão.' },
        { id: 'REQUIRE_APPROVAL', label: 'Aprovação', description: 'Prepara ações que alteram dados e aguarda aprovação humana. Padrão recomendado.' },
        { id: 'CONTROLLED_AUTONOMY', label: 'Autonomia controlada', description: 'Executa ações pré-autorizadas dentro da allowlist; só etapas marcadas pedem aprovação.' },
      ],
    });
  });

  fastify.get('/:id', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const agent = await findOwned(workspaceId, id);
    if (!agent) return reply.status(404).send({ message: 'Agente não encontrado' });
    const stats = (await agentStats(workspaceId, [id])).get(id);
    const [executions, costByDay] = await Promise.all([
      prisma.agentExecution.findMany({
        where: { agentId: id, workspaceId },
        orderBy: { queuedAt: 'desc' },
        take: 25,
        select: { id: true, status: true, trigger: true, sandbox: true, queuedAt: true, startedAt: true, finishedAt: true, cost: true, tokensInput: true, tokensOutput: true, actionsCount: true, error: true, errorKind: true, attempts: true },
      }),
      prisma.$queryRaw<Array<{ day: Date; cost: number; runs: bigint }>>`
        SELECT date_trunc('day', "queuedAt") AS day, COALESCE(SUM(cost),0)::float AS cost, COUNT(*) AS runs
        FROM agent_executions WHERE "agentId" = ${id} AND "workspaceId" = ${workspaceId} AND "queuedAt" > now() - interval '30 days'
        GROUP BY 1 ORDER BY 1`,
    ]);
    return reply.send({
      ...present(agent, stats),
      executions,
      costByDay: costByDay.map((r) => ({ day: r.day, cost: r.cost, runs: Number(r.runs) })),
    });
  });

  fastify.post('/', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const data = AgentBody.parse(request.body);
    const kind = data.kind ?? 'STUDIO';
    if (kind === 'OPERATIONAL') {
      try {
        await validateOperational(workspaceId, data);
      } catch (err: any) {
        return reply.status(400).send({ message: err.message });
      }
    }

    const agent = await prisma.agent.create({
      data: {
        ...data,
        kind,
        playbook: data.playbook ?? undefined,
        scheduleConfig: data.scheduleConfig ?? undefined,
        allowedDomains: (data.allowedDomains || []).map(normalizeDomain).filter(Boolean),
        tools: data.tools || [],
        initials: initialsFrom(data.name),
        workspaceId,
        // Diretriz §22: agente recém-criado nunca nasce ativo.
        status: kind === 'OPERATIONAL' ? 'DRAFT' : 'ACTIVE',
        webhookToken: data.scheduleType === 'webhook' ? randomToken() : undefined,
      },
    });
    await audit(workspaceId, userId, 'agent.create', 'agent', agent.id, { name: agent.name, kind });
    return reply.status(201).send(present(agent));
  });

  fastify.patch('/:id', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const data = AgentBody.partial().parse(request.body);
    const existing = await findOwned(workspaceId, id);
    if (!existing) return reply.status(404).send({ message: 'Agente não encontrado' });

    const operational = (data.kind ?? existing.kind) === 'OPERATIONAL';
    if (operational) {
      try {
        await validateOperational(workspaceId, data, existing);
      } catch (err: any) {
        return reply.status(400).send({ message: err.message });
      }
    }

    // Mudança de playbook/ferramentas/políticas invalida o último teste: exige novo teste antes de reativar.
    const behaviourChanged = ['playbook', 'toolIds', 'allowedDomains', 'autonomyLevel', 'model', 'systemPrompt'].some(
      (k) => (data as any)[k] !== undefined && JSON.stringify((data as any)[k]) !== JSON.stringify((existing as any)[k]),
    );

    const agent = await prisma.agent.update({
      where: { id },
      data: {
        ...data,
        playbook: data.playbook === null ? undefined : data.playbook,
        scheduleConfig: data.scheduleConfig === null ? undefined : data.scheduleConfig,
        allowedDomains: data.allowedDomains ? data.allowedDomains.map(normalizeDomain).filter(Boolean) : undefined,
        initials: data.name ? initialsFrom(data.name) : undefined,
        webhookToken: data.scheduleType === 'webhook' && !existing.webhookToken ? randomToken() : undefined,
        ...(operational && behaviourChanged ? { lastTestOk: null, status: existing.status === 'ACTIVE' ? 'PAUSED' : existing.status } : {}),
      },
    });
    if (operational) await syncAgentSchedule(agent).catch(() => {});
    await audit(workspaceId, userId, 'agent.update', 'agent', id, {
      fields: Object.keys(data),
      ...(operational && behaviourChanged && existing.status === 'ACTIVE' ? { autoPaused: true } : {}),
    });
    return reply.send(present(agent));
  });

  fastify.delete('/:id', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const existing = await findOwned(workspaceId, id);
    if (!existing) return reply.status(404).send({ message: 'Agente não encontrado' });

    await prisma.agent.delete({ where: { id } });
    await syncAgentSchedule({ ...existing, status: 'PAUSED' }).catch(() => {});
    await audit(workspaceId, userId, 'agent.delete', 'agent', id, { name: existing.name });
    return reply.status(204).send();
  });

  // ── Ciclo de vida do agente operacional ──

  fastify.post('/:id/test', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const agent = await findOwned(workspaceId, id);
    if (!agent || agent.kind !== 'OPERATIONAL') return reply.status(404).send({ message: 'Agente operacional não encontrado' });
    const input = (request.body as any)?.input;
    const execution = await createAndEnqueue(agent, 'test', input);
    if (agent.status === 'DRAFT') await prisma.agent.update({ where: { id }, data: { status: 'TESTING' } });
    await audit(workspaceId, userId, 'agent.test', 'agent', id, { executionId: execution.id });
    return reply.status(202).send({ executionId: execution.id });
  });

  fastify.post('/:id/run', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const agent = await findOwned(workspaceId, id);
    if (!agent || agent.kind !== 'OPERATIONAL') return reply.status(404).send({ message: 'Agente operacional não encontrado' });
    if (agent.status !== 'ACTIVE') return reply.status(409).send({ message: 'Ative o agente antes de executá-lo em produção (ou use "Testar").' });
    const input = (request.body as any)?.input;
    const execution = await createAndEnqueue(agent, 'manual', input);
    await audit(workspaceId, userId, 'agent.run', 'agent', id, { executionId: execution.id });
    return reply.status(202).send({ executionId: execution.id });
  });

  fastify.post('/:id/activate', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const agent = await findOwned(workspaceId, id);
    if (!agent || agent.kind !== 'OPERATIONAL') return reply.status(404).send({ message: 'Agente operacional não encontrado' });
    if (agent.lastTestOk !== true) {
      return reply.status(409).send({ message: 'Execute um teste com sucesso antes de ativar (diretriz: nunca ativar sem teste).' });
    }
    const updated = await prisma.agent.update({ where: { id }, data: { status: 'ACTIVE', enabled: true } });
    try {
      await syncAgentSchedule(updated);
    } catch (err: any) {
      await prisma.agent.update({ where: { id }, data: { status: agent.status } });
      return reply.status(503).send({ message: `Não foi possível registrar a agenda: ${err.message}` });
    }
    await audit(workspaceId, userId, 'agent.activate', 'agent', id, { schedule: cronFor(updated) });
    return reply.send(present(updated));
  });

  fastify.post('/:id/pause', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const agent = await findOwned(workspaceId, id);
    if (!agent) return reply.status(404).send({ message: 'Agente não encontrado' });
    const updated = await prisma.agent.update({ where: { id }, data: { status: 'PAUSED', enabled: false } });
    await syncAgentSchedule(updated).catch(() => {});
    await audit(workspaceId, userId, 'agent.pause', 'agent', id);
    return reply.send(present(updated));
  });

  fastify.post('/:id/webhook-token', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const agent = await findOwned(workspaceId, id);
    if (!agent) return reply.status(404).send({ message: 'Agente não encontrado' });
    const updated = await prisma.agent.update({ where: { id }, data: { webhookToken: randomToken() } });
    await audit(workspaceId, userId, 'agent.webhook_rotate', 'agent', id);
    return reply.send({ webhookUrl: `/api/hooks/agents/${updated.webhookToken}` });
  });
}

