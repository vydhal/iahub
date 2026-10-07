import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';

export async function workspaceRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: { include: { _count: { select: { members: true, brands: true } } } } },
    });
    return reply.send(memberships.map((m: any) => m.workspace));
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).id;
    const bodySchema = z.object({ name: z.string().min(2) });
    const { name } = bodySchema.parse(request.body);

    const workspace = await prisma.workspace.create({
      data: {
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString().slice(-4),
        members: {
          create: { userId, role: 'OWNER' },
        },
      },
    });

    return reply.status(201).send(workspace);
  });

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      name: z.string().min(2).optional(),
      defaultFormat: z.string().optional(),
      defaultVariationCount: z.number().int().min(1).max(4).optional(),
      autoReview: z.boolean().optional(),
      creditsAlertPct: z.number().int().min(1).max(100).optional(),
      creditsTotal: z.number().int().min(0).optional(),
    });
    const data = bodySchema.parse(request.body);

    const userId = (request.user as any).id;
    const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId } } });
    if (!membership) return reply.status(404).send({ message: 'Workspace não encontrado' });
    if (membership.role === 'MEMBER') return reply.status(403).send({ message: 'Apenas administradores alteram o workspace.' });

    const workspace = await prisma.workspace.update({
      where: { id },
      data,
      include: { _count: { select: { members: true, brands: true } } },
    });
    return reply.send(workspace);
  });
}
