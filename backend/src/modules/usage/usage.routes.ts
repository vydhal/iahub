import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/prisma.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

export async function usageRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: fastify.tenantGuard }, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    const records = await prisma.usageRecord.findMany({
      where: { workspaceId },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      creditsUsed: workspace?.creditsUsed ?? 0,
      creditsTotal: workspace?.creditsTotal ?? 5000,
      plan: workspace?.plan || 'Studio',
      records,
    });
  });
}
