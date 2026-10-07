import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';
import { orchestratorService } from '../../shared/orchestrator/OrchestratorService.js';

export async function campaignRoutes(fastify: FastifyInstance) {
  // Lista campanhas
  fastify.get('/', { preHandler: fastify.moduleGuard('campanhas') }, async (request, reply) => {
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId: tenantOf(request).workspaceId },
      include: {
        brand: true,
        creatives: {
          include: {
            versions: {
              include: { assets: true },
            },
          },
        },
        workflows: {
          include: { steps: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(campaigns);
  });

  // Busca detalhes de uma campanha por ID
  fastify.get('/:id', { preHandler: fastify.moduleGuard('campanhas') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: tenantOf(request).workspaceId },
      include: {
        brand: true,
        creatives: {
          include: {
            versions: {
              include: { assets: true },
            },
          },
        },
        workflows: {
          include: { steps: { orderBy: { stepNumber: 'asc' } } },
        },
      },
    });

    if (!campaign) return reply.status(404).send({ message: 'Campanha não encontrada' });
    return reply.send(campaign);
  });

  // Cria uma nova campanha e inicia o Orquestrador
  fastify.post('/', { preHandler: fastify.moduleGuard('campanhas') }, async (request, reply) => {
    const bodySchema = z.object({
      workspaceId: z.string().optional(),
      brandName: z.string().optional(),
      name: z.string().optional(),
      description: z.string(),
      objective: z.string().optional(),
      audience: z.string().optional(),
      tone: z.string().optional(),
      contentType: z.string().optional(),
      format: z.string().optional(),
    });

    const data = bodySchema.parse(request.body);

    const workspace = { id: tenantOf(request).workspaceId };

    const brand = await prisma.brand.findFirst({
      where: { workspaceId: workspace.id, name: data.brandName || 'Simplisoft' },
    });

    const campaign = await prisma.campaign.create({
      data: {
        workspaceId: workspace.id,
        brandId: brand?.id,
        name: data.name || `Campanha - ${data.description.slice(0, 25)}...`,
        description: data.description,
        objective: data.objective || 'Gerar leads',
        audience: data.audience || 'Donos de pequenas empresas',
        tone: data.tone || 'Profissional',
        contentType: data.contentType || 'Campanha completa',
        format: data.format || '1080 × 1080',
        status: 'PROCESSING',
      },
    });

    // Observação: a execução do workflow é disparada pelo cliente via SSE (GET /:id/stream)
    // ou de forma síncrona via POST /:id/run — não é enfileirada aqui para evitar
    // rodar o pipeline de IA duas vezes para a mesma campanha.
    return reply.status(201).send({
      message: 'Campanha criada com sucesso.',
      campaign,
    });
  });

  // Executa o workflow de forma síncrona/direta (para testes e resposta rápida)
  fastify.post('/:id/run', { preHandler: fastify.moduleGuard('campanhas') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const owned = await prisma.campaign.findFirst({ where: { id, workspaceId: tenantOf(request).workspaceId }, select: { id: true } });
    if (!owned) return reply.status(404).send({ message: 'Campanha não encontrada' });
    const result = await orchestratorService.executeCampaignWorkflow(id);
    return reply.send(result);
  });

  // Endpoint SSE (Server-Sent Events) para acompanhamento em Tempo Real
  // EventSource não envia headers: o JWT chega em ?token= e é verificado antes de abrir o stream.
  fastify.get('/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };
    let userId: string;
    try {
      userId = (fastify.jwt.verify(token || '') as any).id;
    } catch {
      return reply.status(401).send({ message: 'Token não fornecido ou inválido.' });
    }
    const owned = await prisma.campaign.findFirst({
      where: { id, workspace: { members: { some: { userId } } } },
      select: { id: true },
    });
    if (!owned) return reply.status(404).send({ message: 'Campanha não encontrada' });

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    reply.raw.write(`data: ${JSON.stringify({ type: 'CONNECTED', campaignId: id })}\n\n`);

    // Inicia a execução com callback transmitindo via SSE
    try {
      await orchestratorService.executeCampaignWorkflow(id, (step, label, data) => {
        const payload = JSON.stringify({ step, label, data, timestamp: new Date() });
        reply.raw.write(`data: ${payload}\n\n`);
      });

      reply.raw.write(`data: ${JSON.stringify({ type: 'COMPLETED', step: 7, label: 'Finalizado' })}\n\n`);
      reply.raw.end();
    } catch (err: any) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'ERROR', error: err.message })}\n\n`);
      reply.raw.end();
    }
  });
}
