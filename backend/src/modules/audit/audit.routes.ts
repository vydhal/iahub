import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

export async function auditRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: fastify.tenantGuard }, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    const logs = await prisma.auditLog.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: limit });
    const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return reply.send(logs.map((l) => ({ ...l, userName: l.userId ? names.get(l.userId) || '—' : 'Sistema' })));
  });
}
