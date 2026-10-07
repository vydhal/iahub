import type { Agent } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import cronParser from 'cron-parser';
import { prisma } from '../config/prisma.js';
import { redisConnection } from '../config/redis.js';
import { runExecution } from './engine.js';

export const AGENT_QUEUE = 'agent-executions';
export const agentQueue = new Queue(AGENT_QUEUE, { connection: redisConnection });

type ScheduleConfig = { time?: string; weekdays?: number[]; dayOfMonth?: number; cron?: string };

/** Converte a agenda amigável da UI em expressão cron. null = sem execução automática. */
export function cronFor(agent: Pick<Agent, 'scheduleType' | 'scheduleConfig'>): string | null {
  const cfg = (agent.scheduleConfig || {}) as ScheduleConfig;
  const [h, m] = (cfg.time || '08:00').split(':').map((n) => parseInt(n, 10));
  const hh = Number.isFinite(h) ? h : 8;
  const mm = Number.isFinite(m) ? m : 0;
  const days = cfg.weekdays?.length ? [...new Set(cfg.weekdays)].sort().join(',') : '*';
  switch (agent.scheduleType) {
    case 'daily': return `${mm} ${hh} * * ${days}`;
    case 'weekly': return `${mm} ${hh} * * ${cfg.weekdays?.length ? days : '1'}`;
    case 'monthly': return `${mm} ${hh} ${cfg.dayOfMonth || 1} * *`;
    case 'cron': return cfg.cron || null;
    default: return null;
  }
}

export function validateCron(expr: string, tz: string) {
  cronParser.parseExpression(expr, { tz });
}

export function nextRunOf(agent: Pick<Agent, 'status' | 'scheduleType' | 'scheduleConfig' | 'timezone'>): Date | null {
  if (agent.status !== 'ACTIVE') return null;
  const expr = cronFor(agent);
  if (!expr) return null;
  try {
    return cronParser.parseExpression(expr, { tz: agent.timezone }).next().toDate();
  } catch {
    return null;
  }
}

/** Mantém o agendamento do BullMQ coerente com o status/agenda do agente. */
export async function syncAgentSchedule(agent: Agent) {
  const id = `agent-${agent.id}`;
  const expr = agent.status === 'ACTIVE' ? cronFor(agent) : null;
  if (!expr) {
    await agentQueue.removeJobScheduler(id);
    return;
  }
  await agentQueue.upsertJobScheduler(
    id,
    { pattern: expr, tz: agent.timezone },
    { name: 'scheduled', data: { agentId: agent.id }, opts: { removeOnComplete: 200, removeOnFail: 500 } },
  );
}

export async function enqueueExecution(executionId: string, maxRetries: number) {
  await agentQueue.add(
    'run',
    { executionId },
    {
      jobId: `${executionId}-${Date.now()}`,
      attempts: Math.max(1, maxRetries + 1),
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  );
}

/** Cria o registro da execução e enfileira. Nunca executa dentro da requisição HTTP (diretriz §11). */
export async function createAndEnqueue(agent: Agent, trigger: 'manual' | 'schedule' | 'webhook' | 'test', input?: unknown) {
  const execution = await prisma.agentExecution.create({
    data: {
      workspaceId: agent.workspaceId!,
      agentId: agent.id,
      trigger,
      sandbox: trigger === 'test',
      input: (input ?? {}) as any,
      model: agent.model,
    },
  });
  try {
    await enqueueExecution(execution.id, trigger === 'test' ? 0 : agent.maxRetries);
  } catch (err: any) {
    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: { status: 'failed', error: `Fila indisponível: ${err?.message || err}`, errorKind: 'RECOVERABLE', finishedAt: new Date() },
    });
    throw err;
  }
  return execution;
}

let worker: Worker | null = null;

export async function startAgentWorker() {
  if (worker) return worker;
  worker = new Worker(
    AGENT_QUEUE,
    async (job) => {
      if (job.name === 'scheduled') {
        const agent = await prisma.agent.findUnique({ where: { id: job.data.agentId } });
        if (!agent || agent.status !== 'ACTIVE') return { skipped: true };
        const execution = await createAndEnqueue(agent, 'schedule');
        return { executionId: execution.id };
      }
      const attempt = job.attemptsMade + 1;
      const outcome = await runExecution(job.data.executionId, { attempt, finalAttempt: attempt >= (job.opts.attempts ?? 1) });
      // Lançar faz o BullMQ reagendar com backoff exponencial; o estado da execução já foi salvo.
      if (outcome === 'retry') throw new Error('Falha recuperável — nova tentativa');
      return { outcome };
    },
    { connection: redisConnection, concurrency: 3 },
  );
  worker.on('failed', (job, err) => {
    if (job?.name === 'scheduled') console.error(`💥 Disparo agendado falhou (${job.data.agentId}):`, err.message);
  });

  // Reconcilia agendas na subida (ex: Redis reiniciado sem persistência).
  const active = await prisma.agent.findMany({ where: { kind: 'OPERATIONAL', status: 'ACTIVE' } });
  for (const agent of active) {
    await syncAgentSchedule(agent).catch((err) => console.error(`Agenda inválida para ${agent.name}:`, err.message));
  }
  console.log(`🤖 Worker de agentes ativo · ${active.length} agente(s) ativo(s) sincronizado(s)`);
  return worker;
}
