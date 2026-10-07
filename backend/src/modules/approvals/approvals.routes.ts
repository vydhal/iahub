import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { emptyState, ExecutionState } from '../../agent-ops/providers/ExecutionProvider.js';
import { enqueueExecution } from '../../agent-ops/queue.js';
import { audit } from '../../shared/audit/audit.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

const Decision = z.object({
  note: z.string().max(2000).optional(),
  /** "Editar": campos do input da ação substituídos pelo aprovador antes de executar */
  editedInput: z.record(z.any()).optional(),
});

export async function approvalRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('agentes') };

  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { status } = z.object({ status: z.string().default('pending') }).parse(request.query);
    const approvals = await prisma.approvalRequest.findMany({
      where: { workspaceId, ...(status === 'all' ? {} : { status }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { execution: { select: { id: true, trigger: true, queuedAt: true, agent: { select: { name: true, initials: true, autonomyLevel: true } } } } },
    });
    return reply.send(approvals);
  });

  async function decide(request: any, reply: any, approve: boolean) {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const body = Decision.parse(request.body || {});

    const approval = await prisma.approvalRequest.findFirst({
      where: { id, workspaceId },
      include: { execution: { include: { agent: true } } },
    });
    if (!approval) return reply.status(404).send({ message: 'Solicitação não encontrada' });
    if (approval.status !== 'pending') return reply.status(409).send({ message: `Solicitação já ${approval.status}.` });
    if (approval.execution.status !== 'waiting_approval') {
      return reply.status(409).send({ message: 'A execução não está mais aguardando aprovação.' });
    }

    const state: ExecutionState = { ...emptyState(), ...((approval.execution.state as any) || {}) };
    if (approve) {
      state.approvedSteps = [...new Set([...state.approvedSteps, approval.stepId])];
      if (body.editedInput) {
        // Patch aplicado sobre o input resolvido na retomada (a proposta exibida está redigida).
        // A credencial não pode ser trocada por quem aprova.
        const { credential: _ignored, ...patch } = body.editedInput;
        state.overrides[approval.stepId] = patch;
      }
    } else {
      state.rejectedSteps = [...new Set([...state.rejectedSteps, approval.stepId])];
    }

    // Reserva a decisão de forma atômica: dois cliques simultâneos não retomam a execução duas vezes.
    const claimed = await prisma.approvalRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: approve ? 'approved' : 'rejected', decidedById: userId, decisionNote: body.note, decidedAt: new Date() },
    });
    if (!claimed.count) return reply.status(409).send({ message: 'Solicitação decidida por outra pessoa.' });

    await prisma.$transaction([
      prisma.agentExecution.update({ where: { id: approval.executionId }, data: { state: state as any, status: 'queued' } }),
      prisma.agentExecutionLog.create({
        data: {
          executionId: approval.executionId,
          level: approve ? 'info' : 'warn',
          stepId: approval.stepId,
          message: `${approve ? 'Aprovado' : 'Rejeitado'}${body.editedInput ? ' com edição' : ''}${body.note ? `: ${body.note}` : ''}`,
        },
      }),
    ]);
    await enqueueExecution(approval.executionId, approval.execution.agent.maxRetries);
    await audit(workspaceId, userId, approve ? 'approval.approve' : 'approval.reject', 'approval_request', id, {
      executionId: approval.executionId,
      stepId: approval.stepId,
      edited: !!body.editedInput,
    });
    return reply.send({ ok: true });
  }

  fastify.post('/:id/approve', guard, (request, reply) => decide(request, reply, true));
  fastify.post('/:id/reject', guard, (request, reply) => decide(request, reply, false));
}
