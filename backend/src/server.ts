import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp();

async function start() {
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`🚀 Servidor AI Creative Studio rodando em http://localhost:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  if (env.RUN_WORKERS) {
    // Import tardio: sem RUN_WORKERS a API sobe sem abrir o consumidor da fila.
    const { startAgentWorker } = await import('./agent-ops/queue.js');
    startAgentWorker().catch((err) => app.log.error({ err }, 'Falha ao iniciar o worker de agentes'));
    const { startPostsWorker } = await import('./modules/scheduler/scheduler.queue.js');
    startPostsWorker().catch((err) => app.log.error({ err }, 'Falha ao iniciar o agendador de posts'));
  }
}

start();
