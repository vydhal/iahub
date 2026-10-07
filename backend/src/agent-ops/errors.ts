// Classificação de falhas (diretriz §12):
// - Recuperável → retry automático (timeout, rede, 5xx, 429, página carregando)
// - Intervenção → pausa + aviso (credencial inválida, CAPTCHA, mudança estrutural, configuração)
// - Política → ação bloqueada pelas regras do agente (domínio, ferramenta não liberada, ação destrutiva)

export type ErrorKind = 'RECOVERABLE' | 'INTERVENTION_REQUIRED' | 'POLICY_BLOCKED' | 'TIMEOUT';

export class AgentOpsError extends Error {
  constructor(message: string, public kind: ErrorKind) {
    super(message);
    this.name = 'AgentOpsError';
  }
}

export class RecoverableError extends AgentOpsError {
  constructor(message: string) {
    super(message, 'RECOVERABLE');
  }
}

export class InterventionError extends AgentOpsError {
  constructor(message: string) {
    super(message, 'INTERVENTION_REQUIRED');
  }
}

export class PolicyError extends AgentOpsError {
  constructor(message: string) {
    super(message, 'POLICY_BLOCKED');
  }
}

export class ExecutionTimeoutError extends AgentOpsError {
  constructor(message: string) {
    super(message, 'TIMEOUT');
  }
}

export function classifyUnknownError(err: unknown): AgentOpsError {
  if (err instanceof AgentOpsError) return err;
  const e = err as any;
  const msg = e?.message ? String(e.message) : String(err);
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout|timed out/i.test(msg)) {
    return new RecoverableError(`Tempo esgotado: ${msg}`);
  }
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network/i.test(msg)) {
    return new RecoverableError(`Falha temporária de rede: ${msg}`);
  }
  if (typeof e?.status === 'number' && (e.status === 429 || e.status >= 500)) {
    return new RecoverableError(`Serviço temporariamente indisponível (${e.status}): ${msg}`);
  }
  return new InterventionError(msg);
}
