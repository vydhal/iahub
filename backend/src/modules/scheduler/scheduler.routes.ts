import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../shared/audit/audit.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';
import { cancelPostJob, runPost, schedulePostJob } from './scheduler.queue.js';
import { CHANNELS, CHANNEL_INFO } from './scheduler.service.js';

const Body = z.object({
  title: z.string().min(1).max(160),
  caption: z.string().max(5000).default(''),
  channel: z.enum(CHANNELS),
  credentialName: z.string().optional(),
  recipients: z.array(z.string().email()).default([]),
  assetIds: z.array(z.string()).max(10).default([]),
  carouselId: z.string().nullable().optional(),
  scheduledFor: z.coerce.date(),
  timezone: z.string().default('America/Sao_Paulo'),
});

export async function schedulerRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('agendador') };

  fastify.get('/catalog', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const credentials = await prisma.credential.findMany({
      where: { workspaceId, status: 'active', type: { in: ['telegram_bot', 'smtp', 'webhook'] } },
      select: { id: true, name: true, type: true },
    });
    return reply.send({ channels: CHANNEL_INFO, credentials });
  });

  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { status } = z.object({ status: z.string().optional() }).parse(request.query);
    const posts = await prisma.scheduledPost.findMany({
      where: { workspaceId, ...(status && status !== 'all' ? { status } : {}) },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    });
    return reply.send(posts);
  });

  fastify.post('/', guard, async (request, reply) => {
    const { workspaceId, userId, workspace } = tenantOf(request);
    const body = Body.parse(request.body);

    const pending = await prisma.scheduledPost.count({ where: { workspaceId, status: { in: ['scheduled', 'publishing'] } } });
    if (workspace.maxScheduledPosts > 0 && pending >= workspace.maxScheduledPosts) {
      return reply.status(409).send({ message: `Seu plano permite ${workspace.maxScheduledPosts} publicações agendadas ao mesmo tempo.` });
    }
    if (body.scheduledFor.getTime() < Date.now() - 60_000) {
      return reply.status(400).send({ message: 'Escolha uma data e hora no futuro.' });
    }
    if (body.channel !== 'webhook' && !body.credentialName) {
      return reply.status(400).send({ message: 'Escolha a credencial do canal de entrega.' });
    }
    if (body.assetIds.length) {
      const count = await prisma.mediaAsset.count({ where: { workspaceId, id: { in: body.assetIds } } });
      if (count !== body.assetIds.length) return reply.status(400).send({ message: 'Alguma imagem selecionada não pertence a esta conta.' });
    }

    const post = await prisma.scheduledPost.create({ data: { ...body, workspaceId, createdById: userId } });
    try {
      await schedulePostJob(post.id, post.scheduledFor);
    } catch (err: any) {
      await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'failed', error: `Fila indisponível: ${err.message}` } });
      return reply.status(503).send({ message: `Não foi possível agendar: ${err.message}` });
    }
    await audit(workspaceId, userId, 'post.schedule', 'scheduled_post', post.id, { canal: post.channel, quando: post.scheduledFor });
    return reply.status(201).send(post);
  });

  fastify.patch('/:id', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const body = Body.partial().parse(request.body);
    const post = await prisma.scheduledPost.findFirst({ where: { id, workspaceId } });
    if (!post) return reply.status(404).send({ message: 'Publicação não encontrada' });
    if (post.status === 'published') return reply.status(409).send({ message: 'Publicação já entregue.' });

    const updated = await prisma.scheduledPost.update({
      where: { id },
      data: { ...body, status: 'scheduled', error: null },
    });
    await schedulePostJob(updated.id, updated.scheduledFor);
    await audit(workspaceId, userId, 'post.reschedule', 'scheduled_post', id, { quando: updated.scheduledFor });
    return reply.send(updated);
  });

  fastify.post('/:id/publish-now', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const post = await prisma.scheduledPost.findFirst({ where: { id, workspaceId } });
    if (!post) return reply.status(404).send({ message: 'Publicação não encontrada' });
    if (post.status === 'published') return reply.status(409).send({ message: 'Publicação já entregue.' });

    await cancelPostJob(id);
    try {
      const done = await runPost(id);
      await audit(workspaceId, userId, 'post.publish_now', 'scheduled_post', id);
      return reply.send(done);
    } catch (err: any) {
      return reply.status(502).send({ message: err.message });
    }
  });

  fastify.post('/:id/cancel', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const post = await prisma.scheduledPost.findFirst({ where: { id, workspaceId } });
    if (!post) return reply.status(404).send({ message: 'Publicação não encontrada' });
    if (post.status === 'published') return reply.status(409).send({ message: 'Publicação já entregue.' });

    await cancelPostJob(id);
    const updated = await prisma.scheduledPost.update({ where: { id }, data: { status: 'canceled' } });
    await audit(workspaceId, userId, 'post.cancel', 'scheduled_post', id);
    return reply.send(updated);
  });

  fastify.delete('/:id', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const post = await prisma.scheduledPost.findFirst({ where: { id, workspaceId } });
    if (!post) return reply.status(404).send({ message: 'Publicação não encontrada' });
    await cancelPostJob(id);
    await prisma.scheduledPost.delete({ where: { id } });
    return reply.status(204).send();
  });
}
