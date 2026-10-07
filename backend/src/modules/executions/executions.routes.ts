import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../shared/audit/audit.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

export async function executionRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('agentes') };

  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const q = z
      .object({
        agentId: z.string().optional(),
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);
    const executions = await prisma.agentExecution.findMany({
      where: { workspaceId, ...(q.agentId ? { agentId: q.agentId } : {}), ...(q.status ? { status: q.status } : {}) },
      orderBy: { queuedAt: 'desc' },
      take: q.limit,
      select: {
        id: true, agentId: true, status: true, trigger: true, sandbox: true, queuedAt: true, startedAt: true, finishedAt: true,
        cost: true, tokensInput: true, tokensOutput: true, actionsCount: true, attempts: true, error: true, errorKind: true, failedStep: true, model: true,
        agent: { select: { name: true, initials: true } },
      },
    });
    return reply.send(executions);
  });

  fastify.get('/:id', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const execution = await prisma.agentExecution.findFirst({
      where: { id, workspaceId },
      include: {
        agent: { select: { id: true, name: true, initials: true, autonomyLevel: true, playbook: true } },
        logs: { orderBy: { createdAt: 'asc' } },
        approvals: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!execution) return reply.status(404).send({ message: 'Execução não encontrada' });
    // `state` guarda o contexto interno de retomada; a UI recebe só o que precisa.
    const { state, ...rest } = execution;
    return reply.send({ ...rest, stepStatus: (state as any)?.stepStatus ?? {} });
  });

  fastify.post('/:id/cancel', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const execution = await prisma.agentExecution.findFirst({ where: { id, workspaceId } });
    if (!execution) return reply.status(404).send({ message: 'Execução não encontrada' });
    if (['completed', 'failed', 'cancelled'].includes(execution.status)) {
      return reply.status(409).send({ message: 'Execução já finalizada.' });
    }
    await prisma.$transaction([
      prisma.agentExecution.update({ where: { id }, data: { status: 'cancelled', finishedAt: new Date() } }),
      prisma.approvalRequest.updateMany({ where: { executionId: id, status: 'pending' }, data: { status: 'expired', decidedAt: new Date() } }),
      prisma.agentExecutionLog.create({ data: { executionId: id, level: 'warn', message: 'Cancelamento solicitado pelo usuário.' } }),
    ]);
    await audit(workspaceId, userId, 'execution.cancel', 'agent_execution', id);
    return reply.send({ ok: true });
  });
}
