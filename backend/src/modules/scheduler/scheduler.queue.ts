import { Queue, Worker } from 'bullmq';
import { prisma } from '../../config/prisma.js';
import { redisConnection } from '../../config/redis.js';
import { publishPost } from './scheduler.service.js';

export const POSTS_QUEUE = 'scheduled-posts';
export const postsQueue = new Queue(POSTS_QUEUE, { connection: redisConnection });

const jobId = (postId: string) => `post-${postId}`;

/** Agenda (ou reagenda) a entrega do post para o horário escolhido. */
export async function schedulePostJob(postId: string, scheduledFor: Date) {
  await cancelPostJob(postId);
  const delay = Math.max(0, scheduledFor.getTime() - Date.now());
  await postsQueue.add(
    'publish',
    { postId },
    { jobId: jobId(postId), delay, attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 500, removeOnFail: 1000 },
  );
}

export async function cancelPostJob(postId: string) {
  const job = await postsQueue.getJob(jobId(postId));
  if (job) await job.remove().catch(() => {});
}

/** Executa a entrega agora (botão "publicar agora" e também o worker). */
export async function runPost(postId: string) {
  const post = await prisma.scheduledPost.findUnique({ where: { id: postId }, include: { workspace: true } });
  if (!post) return { skipped: 'post removido' };
  if (['published', 'canceled'].includes(post.status)) return { skipped: post.status };
  // Conta suspensa não entrega nada — a publicação fica pendente para quando reativar.
  if (post.workspace.status === 'suspended') {
    await prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'failed', error: 'Conta suspensa no momento da publicação.' } });
    return { skipped: 'conta suspensa' };
  }

  await prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'publishing', attempts: { increment: 1 }, error: null } });
  try {
    const { result } = await publishPost(post);
    return prisma.scheduledPost.update({
      where: { id: postId },
      data: { status: 'published', publishedAt: new Date(), result: result as any, error: null },
    });
  } catch (err: any) {
    await prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'failed', error: err?.message || String(err) } });
    throw err;
  }
}

let worker: Worker | null = null;

export async function startPostsWorker() {
  if (worker) return worker;
  worker = new Worker(POSTS_QUEUE, async (job) => runPost(job.data.postId), { connection: redisConnection, concurrency: 3 });
  worker.on('failed', (job, err) => console.error(`💥 Publicação agendada falhou (${job?.data?.postId}):`, err.message));

  // Reconcilia agendamentos ao subir (Redis reiniciado, deploy etc.)
  const pending = await prisma.scheduledPost.findMany({ where: { status: 'scheduled' } });
  for (const post of pending) await schedulePostJob(post.id, post.scheduledFor).catch(() => {});
  console.log(`🗓️  Agendador de posts ativo · ${pending.length} publicação(ões) pendente(s)`);
  return worker;
}
