import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

const brandInclude = { colors: true, voices: true, products: true, services: true } as const;

export async function brandRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('marcas') };
  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const brands = await prisma.brand.findMany({ where: { workspaceId }, include: brandInclude, orderBy: { createdAt: 'asc' } });
    return reply.send(brands);
  });

  fastify.post('/', guard, async (request, reply) => {
    const bodySchema = z.object({
      workspaceId: z.string().optional(),
      name: z.string(),
      sector: z.string(),
      description: z.string().optional(),
      targetAudience: z.string().optional(),
      preferredWords: z.array(z.string()).optional(),
      bannedWords: z.array(z.string()).optional(),
      colors: z.array(z.string()).optional(),
      products: z.array(z.string()).optional(),
      services: z.array(z.string()).optional(),
    });

    // workspaceId do corpo é ignorado: o tenant vem sempre da sessão autenticada.
    const { colors, products, services, workspaceId: _ignored, ...rest } = bodySchema.parse(request.body);
    const { workspaceId: wsId, workspace } = tenantOf(request);
    // Limite de marcas do plano contratado
    const brandCount = await prisma.brand.count({ where: { workspaceId: wsId } });
    if (workspace.maxBrands > 0 && brandCount >= workspace.maxBrands) {
      return reply.status(409).send({
        message: `Seu plano permite ${workspace.maxBrands} marca(s). Exclua uma marca ou fale com a Simplisoft para ampliar o limite.`,
      });
    }

    const brand = await prisma.brand.create({
      data: {
        ...rest,
        workspaceId: wsId,
        preferredWords: rest.preferredWords || [],
        bannedWords: rest.bannedWords || [],
        colors: colors && colors.length ? { create: colors.map((hex) => ({ hex })) } : undefined,
        products: products && products.length ? { create: products.map((name) => ({ name })) } : undefined,
        services: services && services.length ? { create: services.map((name) => ({ name })) } : undefined,
      },
      include: brandInclude,
    });

    return reply.status(201).send(brand);
  });

  fastify.patch('/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      name: z.string().optional(),
      sector: z.string().optional(),
      description: z.string().optional(),
      targetAudience: z.string().optional(),
      preferredWords: z.array(z.string()).optional(),
      bannedWords: z.array(z.string()).optional(),
      colors: z.array(z.string()).optional(),
      products: z.array(z.string()).optional(),
      services: z.array(z.string()).optional(),
    });

    const { colors, products, services, ...rest } = bodySchema.parse(request.body);
    const existing = await prisma.brand.findFirst({ where: { id, workspaceId: tenantOf(request).workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Marca não encontrada' });

    const brand = await prisma.brand.update({
      where: { id },
      data: {
        ...rest,
        colors: colors ? { deleteMany: {}, create: colors.map((hex) => ({ hex })) } : undefined,
        products: products ? { deleteMany: {}, create: products.map((name) => ({ name })) } : undefined,
        services: services ? { deleteMany: {}, create: services.map((name) => ({ name })) } : undefined,
      },
      include: brandInclude,
    });

    return reply.send(brand);
  });

  fastify.delete('/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.brand.findFirst({ where: { id, workspaceId: tenantOf(request).workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Marca não encontrada' });

    await prisma.brand.delete({ where: { id } });
    return reply.status(204).send();
  });
}
