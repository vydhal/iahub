import { Redis } from 'ioredis';
import { env } from './env.js';

export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
});

redisConnection.on('connect', () => {
  console.log('⚡ Redis conectado com sucesso');
});

redisConnection.on('error', (err: Error) => {
  console.error('❌ Erro no Redis:', err);
});
