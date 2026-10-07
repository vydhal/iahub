import type { Workspace } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../config/prisma.js';
import { ModuleKey, moduleEnabled, MODULES } from '../modules/catalog.js';

export interface TenantContext {
  userId: string;
  workspaceId: string;
  role: string;
  userRole: string;
  workspace: Workspace;
}

/**
 * Resolve a conta (workspace) da requisição a partir do usuário autenticado e aplica,
 * nesta ordem: usuário desativado → conta suspensa → módulo contratado (via requireModule).
 */
export async function resolveTenant(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request.user as any)?.id as string | undefined;
  if (!userId) return reply.status(401).send({ message: 'Não autenticado.' });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, active: true } });
  if (!user) return reply.status(401).send({ message: 'Usuário não encontrado.' });
  if (!user.active) {
    return reply.status(403).send({ message: 'Seu acesso foi desativado. Procure o administrador da plataforma.' });
  }

  const requested = request.headers['x-workspace-id'];
  const workspaceId = typeof requested === 'string' && requested ? requested : undefined;

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { workspace: true },
  });

  if (!membership) {
    return reply.status(403).send({ message: 'Usuário sem acesso a este workspace.' });
  }

  const workspace = membership.workspace;
  if (workspace.status === 'suspended' && user.role !== 'SUPERADMIN') {
    return reply.status(423).send({
      message: workspace.suspendedReason
        ? `Acesso suspenso: ${workspace.suspendedReason}`
        : 'Acesso suspenso. Fale com a Simplisoft para reativar a assinatura.',
      suspended: true,
    });
  }

  request.tenant = { userId, workspaceId: workspace.id, role: membership.role, userRole: user.role, workspace };
}

export function tenantOf(request: FastifyRequest): TenantContext {
  if (!request.tenant) throw new Error('Tenant não resolvido — rota sem preHandler de tenant.');
  return request.tenant;
}

/** preHandler que exige um módulo contratado. Usado nos grupos de rotas de cada funcionalidade. */
export function requireModule(key: ModuleKey) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant;
    if (!tenant) return reply.status(401).send({ message: 'Não autenticado.' });
    if (!moduleEnabled(tenant.workspace, key)) {
      const label = MODULES.find((m) => m.key === key)?.label || key;
      return reply.status(403).send({
        message: `O módulo “${label}” não faz parte do seu plano. Fale com a Simplisoft para contratá-lo.`,
        module: key,
      });
    }
  };
}

/** Apenas o superadmin da plataforma (Simplisoft). */
export async function requireSuperadmin(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request.user as any)?.id as string | undefined;
  if (!userId) return reply.status(401).send({ message: 'Não autenticado.' });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user?.active || user.role !== 'SUPERADMIN') {
    return reply.status(403).send({ message: 'Área restrita à administração da plataforma.' });
  }
}
