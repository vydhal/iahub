import { prisma } from '../config/prisma.js';
import { sendAgentAlert } from './alerts.js';
import { AgentOpsError, classifyUnknownError, ExecutionTimeoutError } from './errors.js';
import { ToolGateway, UsageTotals } from './gateway.js';
import { ExecutionLogger } from './logger.js';
import { emptyState, ExecutionState } from './providers/ExecutionProvider.js';
import { executionProviders } from './providers/index.js';

export type RunOutcome = 'completed' | 'waiting_approval' | 'failed' | 'retry' | 'cancelled' | 'skipped';

const TERMINAL = ['completed', 'failed', 'cancelled', 'waiting_approval'];

/**
 * Regra provisória de créditos (diretriz §25: estrutura auditável antes do preço definitivo):
 * 1 por execução + 1 a cada 1.000 tokens + 1 por minuto de navegador.
 */
export function creditsFor(u: Pick<UsageTotals, 'tokensInput' | 'tokensOutput' | 'browserMs'>) {
  return 1 + Math.ceil((u.tokensInput + u.tokensOutput) / 1000) + Math.ceil(u.browserMs / 60_000);
}

export async function runExecution(executionId: string, opts: { attempt: number; finalAttempt: boolean }): Promise<RunOutcome> {
  const execution = await prisma.agentExecution.findUnique({ where: { id: executionId }, include: { agent: true } });
  if (!execution || TERMINAL.includes(execution.status)) return 'skipped';
  const agent = execution.agent;
  const logger = new ExecutionLogger(executionId);
  const state: ExecutionState = { ...emptyState(), ...((execution.state as any) || {}) };
  const isFirstRun = !execution.startedAt;

  await prisma.agentExecution.update({
    where: { id: executionId },
    data: { status: 'running', startedAt: execution.startedAt ?? new Date(), attempts: opts.attempt, error: null, errorKind: null },
  });

  if (isFirstRun) {
    await logger.info(`Agente iniciado · gatilho: ${execution.trigger}${execution.sandbox ? ' · MODO TESTE (sem efeitos externos)' : ''}`);
  } else if (opts.attempt > 1 && state.nextStep > 0) {
    await logger.info(`Retomando a partir da etapa ${state.nextStep + 1} (tentativa ${opts.attempt})`);
  } else if (state.approvedSteps.length || state.rejectedSteps.length) {
    await logger.info('Retomando após decisão de aprovação');
  }

  const provider = executionProviders.get(agent.executionProvider);
  const gateway = new ToolGateway(agent, executionId, execution.sandbox, logger, execution.actionsCount);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ExecutionTimeoutError('timeout')), agent.maxDurationSec * 1000);

  const persistUsage = async (extra: Record<string, any>) => {
    const u = gateway.usage;
    await prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        ...extra,
        actionsCount: u.actions,
        tokensInput: { increment: u.tokensInput },
        tokensOutput: { increment: u.tokensOutput },
        cost: { increment: u.cost },
        ...(u.model ? { model: u.model } : {}),
      },
    });
    if (u.tokensInput || u.tokensOutput || u.actions > execution.actionsCount || u.browserMs) {
      await prisma.usageRecord.create({
        data: {
          workspaceId: execution.workspaceId,
          provider: 'agent-ops',
          model: u.model || 'sem-ia',
          operation: execution.sandbox ? 'agent_test' : 'agent_execution',
          tokensInput: u.tokensInput,
          tokensOutput: u.tokensOutput,
          estimatedCost: u.cost,
          agentExecutionId: executionId,
          metadata: { agentId: agent.id, actions: u.actions - execution.actionsCount, browserMs: u.browserMs, tools: u.tools },
        },
      });
      await prisma.workspace.update({
        where: { id: execution.workspaceId },
        data: { creditsUsed: { increment: creditsFor(u) } },
      });
    }
  };

  try {
    if (!provider) throw classifyUnknownError(new Error(`Provedor de execução "${agent.executionProvider}" não está disponível.`));

    const outcome = await provider.run({
      agent,
      execution,
      state,
      gateway,
      logger,
      signal: controller.signal,
      saveState: (s) => prisma.agentExecution.update({ where: { id: executionId }, data: { state: s as any } }).then(() => undefined),
      isCancelled: async () => (await prisma.agentExecution.findUnique({ where: { id: executionId }, select: { status: true } }))?.status === 'cancelled',
    });

    if (outcome.status === 'cancelled') {
      await persistUsage({ finishedAt: new Date() });
      await logger.warn('Execução cancelada pelo usuário.');
      return 'cancelled';
    }

    if (outcome.status === 'waiting_approval') {
      await persistUsage({ status: 'waiting_approval', approvalRequired: true });
      const approval = await prisma.approvalRequest.create({
        data: {
          workspaceId: execution.workspaceId,
          executionId,
          agentId: agent.id,
          stepId: outcome.approval.stepId,
          title: outcome.approval.title,
          proposedAction: outcome.approval.proposedAction,
        },
      });
      await logger.warn(`Aguardando aprovação humana: ${outcome.approval.proposedAction.reason}`, { stepId: outcome.approval.stepId, data: { approvalId: approval.id } });
      const alertErr = await sendAgentAlert(agent, `⏸ ${outcome.approval.title}\nAção aguardando aprovação na Central de Agentes.`);
      if (alertErr) await logger.warn(`Alerta de aprovação não enviado: ${alertErr}`);
      return 'waiting_approval';
    }

    await persistUsage({ status: 'completed', output: outcome.output, finishedAt: new Date() });
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        runs: { increment: execution.sandbox ? 0 : 1 },
        ...(execution.trigger === 'test' ? { lastTestAt: new Date(), lastTestOk: true } : {}),
      },
    });
    await logger.info(`Execução concluída · ${gateway.usage.actions} ações`);
    return 'completed';
  } catch (err) {
    const e: AgentOpsError & { stepId?: string } = classifyUnknownError(err) as any;
    const stepId = (err as any)?.stepId;
    const retryable = (e.kind === 'RECOVERABLE' || e.kind === 'TIMEOUT') && !opts.finalAttempt;

    if (retryable) {
      await persistUsage({ status: 'queued', error: e.message, errorKind: e.kind, failedStep: stepId ?? null });
      await logger.warn(`Tentativa ${opts.attempt} falhou (${e.message}). Nova tentativa agendada.`);
      return 'retry';
    }

    await persistUsage({ status: 'failed', error: e.message, errorKind: e.kind, failedStep: stepId ?? null, finishedAt: new Date() });
    if (execution.trigger === 'test') {
      await prisma.agent.update({ where: { id: agent.id }, data: { lastTestAt: new Date(), lastTestOk: false } });
    }
    await logger.error(`Execução interrompida (${e.kind}): ${e.message}`, { stepId });
    if (!execution.sandbox) {
      const alertErr = await sendAgentAlert(agent, `⚠️ ${agent.name} falhou e precisa de atenção.\nMotivo: ${e.message}`);
      if (alertErr) await logger.warn(`Alerta de falha não enviado: ${alertErr}`);
    }
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}
