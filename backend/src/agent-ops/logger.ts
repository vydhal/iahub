import { prisma } from '../config/prisma.js';
import { redact } from '../shared/security/crypto.js';

export type LogLevel = 'info' | 'warn' | 'error' | 'action';

/** Linha do tempo da execução (diretriz §10). Todo `data` passa por redact — nada de segredo em log. */
export class ExecutionLogger {
  constructor(private executionId: string) {}

  async log(level: LogLevel, message: string, extra: { stepId?: string; tool?: string; data?: unknown; durationMs?: number } = {}) {
    await prisma.agentExecutionLog.create({
      data: {
        executionId: this.executionId,
        level,
        message: message.slice(0, 2000),
        stepId: extra.stepId,
        tool: extra.tool,
        data: extra.data === undefined ? undefined : (redact(extra.data) as any),
        durationMs: extra.durationMs,
      },
    });
  }

  info(message: string, extra?: Parameters<ExecutionLogger['log']>[2]) {
    return this.log('info', message, extra);
  }
  warn(message: string, extra?: Parameters<ExecutionLogger['log']>[2]) {
    return this.log('warn', message, extra);
  }
  error(message: string, extra?: Parameters<ExecutionLogger['log']>[2]) {
    return this.log('error', message, extra);
  }
  action(message: string, extra?: Parameters<ExecutionLogger['log']>[2]) {
    return this.log('action', message, extra);
  }
}
