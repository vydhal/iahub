import type { Agent, AgentExecution } from '@prisma/client';
import type { ToolGateway } from '../gateway.js';
import type { ExecutionLogger } from '../logger.js';

/** Estado persistido entre tentativas e através de aprovações humanas. */
export interface ExecutionState {
  nextStep: number;
  outputs: Record<string, any>;
  stepStatus: Record<string, 'done' | 'skipped' | 'simulated' | 'failed' | 'rejected'>;
  approvedSteps: string[];
  rejectedSteps: string[];
  /** campos editados pelo aprovador ("Editar"), aplicados sobre o input resolvido da etapa */
  overrides: Record<string, any>;
  recommendations: Array<{ step: string; tool: string; action: unknown }>;
}

export function emptyState(): ExecutionState {
  return { nextStep: 0, outputs: {}, stepStatus: {}, approvedSteps: [], rejectedSteps: [], overrides: {}, recommendations: [] };
}

export interface ExecutionRunContext {
  agent: Agent;
  execution: AgentExecution;
  state: ExecutionState;
  gateway: ToolGateway;
  logger: ExecutionLogger;
  signal: AbortSignal;
  saveState: (state: ExecutionState) => Promise<void>;
  isCancelled: () => Promise<boolean>;
}

export type ProviderOutcome =
  | { status: 'completed'; output: Record<string, any> }
  | { status: 'waiting_approval'; approval: { stepId: string; title: string; proposedAction: Record<string, any> } }
  | { status: 'cancelled' };

/**
 * Abstração da camada de execução (diretriz §2): o restante da plataforma não sabe
 * se o agente roda no runtime próprio, num ambiente Claude Code/Cowork ou noutro motor.
 * Novos provedores entram registrando-se em providers/index.ts.
 */
export interface ExecutionProvider {
  id: string;
  label: string;
  description: string;
  run(ctx: ExecutionRunContext): Promise<ProviderOutcome>;
}
