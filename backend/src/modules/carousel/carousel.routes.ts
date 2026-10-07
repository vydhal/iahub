import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { providerRouter } from '../../shared/ai/ProviderRouter.js';
import { hasUsableKey } from '../../shared/ai/keyResolver.js';
import { audit } from '../../shared/audit/audit.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';
import { generateImagePrompt, generateScript, SlideSchema } from './carousel.service.js';

const NO_KEY_MESSAGE =
  'Geração com IA indisponível: cadastre sua chave Anthropic (Claude) em Configurações → Integrações (ou configure ANTHROPIC_API_KEY na plataforma) e desligue o modo simulado.';

const ProjectBody = z.object({
  name: z.string().min(1).max(120),
  topic: z.string().max(2000).optional(),
  format: z.string().default('4:5'),
  status: z.enum(['DRAFT', 'READY', 'PUBLISHED']).optional(),
  brand: z.record(z.any()).optional(),
  theme: z.record(z.any()).optional(),
  slides: z.array(SlideSchema).max(20),
});

export async function carouselRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('carrossel') };

  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const projects = await prisma.carouselProject.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      take: 60,
      select: { id: true, name: true, topic: true, status: true, slideCount: true, format: true, createdAt: true, updatedAt: true },
    });
    return reply.send(projects);
  });

  fastify.get('/:id', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const project = await prisma.carouselProject.findFirst({ where: { id, workspaceId } });
    if (!project) return reply.status(404).send({ message: 'Carrossel não encontrado' });
    return reply.send(project);
  });

  fastify.post('/', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const data = ProjectBody.parse(request.body);
    const project = await prisma.carouselProject.create({
      data: {
        workspaceId,
        createdById: userId,
        name: data.name,
        topic: data.topic,
        format: data.format,
        status: data.status || 'DRAFT',
        brand: data.brand ?? undefined,
        theme: data.theme ?? undefined,
        slides: data.slides as any,
        slideCount: data.slides.length,
      },
    });
    await audit(workspaceId, userId, 'carousel.create', 'carousel_project', project.id, { name: project.name });
    return reply.status(201).send(project);
  });

  fastify.patch('/:id', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const data = ProjectBody.partial().parse(request.body);
    const existing = await prisma.carouselProject.findFirst({ where: { id, workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Carrossel não encontrado' });

    const project = await prisma.carouselProject.update({
      where: { id },
      data: {
        ...data,
        brand: data.brand ?? undefined,
        theme: data.theme ?? undefined,
        slides: data.slides ? (data.slides as any) : undefined,
        slideCount: data.slides ? data.slides.length : undefined,
      },
    });
    return reply.send(project);
  });

  fastify.delete('/:id', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.carouselProject.findFirst({ where: { id, workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Carrossel não encontrado' });
    await prisma.carouselProject.delete({ where: { id } });
    await audit(workspaceId, userId, 'carousel.delete', 'carousel_project', id, { name: existing.name });
    return reply.status(204).send();
  });

  fastify.post('/:id/duplicate', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const source = await prisma.carouselProject.findFirst({ where: { id, workspaceId } });
    if (!source) return reply.status(404).send({ message: 'Carrossel não encontrado' });
    const { id: _omit, createdAt, updatedAt, ...rest } = source;
    const copy = await prisma.carouselProject.create({
      data: { ...rest, name: `${source.name} (cópia)`, createdById: userId, slides: source.slides as any, brand: source.brand as any, theme: source.theme as any },
    });
    return reply.status(201).send(copy);
  });

  // ── IA ──
  fastify.post('/script', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const body = z
      .object({ topic: z.string().min(3), count: z.coerce.number().int().min(3).max(12).default(8), tone: z.string().optional(), brandName: z.string().optional(), audience: z.string().optional() })
      .parse(request.body);
    if (!(await hasUsableKey(workspaceId, 'anthropic'))) {
      return reply.status(422).send({ message: NO_KEY_MESSAGE });
    }
    try {
      return reply.send(await generateScript({ workspaceId, ...body }));
    } catch (err: any) {
      return reply.status(502).send({ message: `Falha ao gerar roteiro: ${err.message}` });
    }
  });

  fastify.post('/image-prompt', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const body = z
      .object({
        slide: z.record(z.any()),
        style: z.string().default('Cinematográfico'),
        composition: z.string().default('Conceitual'),
        format: z.string().default('Vertical 4:5'),
        deckTitles: z.array(z.string()).default([]),
      })
      .parse(request.body);
    if (!(await hasUsableKey(workspaceId, 'anthropic'))) {
      return reply.status(422).send({ message: NO_KEY_MESSAGE });
    }
    try {
      return reply.send(await generateImagePrompt({ workspaceId, ...body } as any));
    } catch (err: any) {
      return reply.status(502).send({ message: `Falha ao criar prompt: ${err.message}` });
    }
  });

  // Geração de imagem real. Sem chave configurada, não inventa: devolve orientação.
  fastify.post('/image', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const body = z.object({ prompt: z.string().min(10), count: z.coerce.number().int().min(1).max(4).default(1) }).parse(request.body);
    if (!(await hasUsableKey(workspaceId, 'openai'))) {
      return reply.status(422).send({
        message: 'Geração de imagem indisponível: cadastre sua chave OpenAI em Configurações → Integrações (ou configure OPENAI_API_KEY na plataforma) e desligue o modo simulado. Enquanto isso, copie o prompt, gere a imagem na ferramenta de sua preferência e importe o arquivo.',
      });
    }
    try {
      const provider = await providerRouter.getProviderForWorkspace('openai', workspaceId);
      const res = await provider.generateImage({ prompt: body.prompt, count: body.count });
      await prisma.usageRecord.create({
        data: { workspaceId, provider: 'openai', model: 'gpt-image', operation: 'carousel_image', imageCount: res.data.length, estimatedCost: res.estimatedCost },
      });
      return reply.send({ images: res.data });
    } catch (err: any) {
      return reply.status(502).send({ message: `Falha ao gerar imagem: ${err.message}` });
    }
  });
}
