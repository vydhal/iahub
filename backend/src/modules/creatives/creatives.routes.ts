import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';
import { orchestratorService } from '../../shared/orchestrator/OrchestratorService.js';

export async function creativeRoutes(fastify: FastifyInstance) {
  // GET /api/creatives
  fastify.get('/', { preHandler: fastify.moduleGuard('campanhas') }, async (request, reply) => {
    const creatives = await prisma.creative.findMany({
      where: { campaign: { workspaceId: tenantOf(request).workspaceId } },
      include: {
        versions: {
          include: { assets: true },
          orderBy: { versionNumber: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(creatives);
  });

  // POST /api/creatives/:versionId/refine
  fastify.post('/:versionId/refine', { preHandler: fastify.moduleGuard('campanhas') }, async (request, reply) => {
    const { versionId } = request.params as { versionId: string };
    const owned = await prisma.creativeVersion.findFirst({
      where: { id: versionId, creative: { campaign: { workspaceId: tenantOf(request).workspaceId } } },
      select: { id: true },
    });
    if (!owned) return reply.status(404).send({ message: 'Versão não encontrada' });
    const bodySchema = z.object({
      prompt: z.string(),
    });

    const { prompt } = bodySchema.parse(request.body);
    const newVersion = await orchestratorService.refineCreativeVersion(versionId, prompt);

    return reply.status(201).send({
      message: 'Nova versão gerada com refinamento com sucesso.',
      version: newVersion,
    });
  });
}
