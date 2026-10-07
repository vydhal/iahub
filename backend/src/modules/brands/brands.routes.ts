import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { extractPalette } from '../../shared/media/colorExtract.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

const brandInclude = { colors: true, voices: true, products: true, services: true } as const;

export const BRANDS_DIR = path.resolve(process.cwd(), 'storage', 'brands');

const LOGO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function present(b: any) {
  return { ...b, logoUrl: b.logoKey ? `/api/brands/${b.id}/logo?v=${new Date(b.updatedAt).getTime()}` : null };
}

export async function brandRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('marcas') };
  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const brands = await prisma.brand.findMany({ where: { workspaceId }, include: brandInclude, orderBy: { createdAt: 'asc' } });
    return reply.send(brands.map(present));
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

    return reply.status(201).send(present(brand));
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

    return reply.send(present(brand));
  });

  fastify.delete('/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.brand.findFirst({ where: { id, workspaceId: tenantOf(request).workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Marca não encontrada' });

    await prisma.brand.delete({ where: { id } });
    await rm(path.join(BRANDS_DIR, existing.workspaceId, id), { recursive: true, force: true });
    return reply.status(204).send();
  });

  // Upload da logo: salva o arquivo e já sugere a paleta extraída das cores dominantes da imagem
  // (mesmo padrão de Looka/Canva Brand Kit/Genna — importa a logo, as cores saem prontas).
  fastify.post('/:id/logo', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { workspaceId } = tenantOf(request);
    const existing = await prisma.brand.findFirst({ where: { id, workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Marca não encontrada' });

    const file = await (request as any).file({ limits: { fileSize: 4 * 1024 * 1024 } });
    if (!file) return reply.status(400).send({ message: 'Envie um arquivo de imagem.' });
    const ext = LOGO_EXT[file.mimetype];
    if (!ext) return reply.status(400).send({ message: `Formato não suportado: ${file.mimetype}. Use PNG, JPG, WEBP ou SVG.` });

    const buffer = await file.toBuffer();
    const dir = path.join(BRANDS_DIR, workspaceId, id);
    await mkdir(dir, { recursive: true });
    const logoKey = `logo.${ext}`;
    await writeFile(path.join(dir, logoKey), buffer);

    // SVG não é um raster — não dá pra amostrar pixel. Extração de cor só para formatos bitmap.
    let extractedColors: string[] | null = null;
    if (ext !== 'svg') {
      try {
        extractedColors = await extractPalette(buffer, 5);
      } catch (err: any) {
        request.log.warn({ err }, 'Falha ao extrair paleta da logo');
      }
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: {
        logoKey,
        logoMime: file.mimetype,
        ...(extractedColors && extractedColors.length ? { colors: { deleteMany: {}, create: extractedColors.map((hex) => ({ hex })) } } : {}),
      },
      include: brandInclude,
    });

    return reply.send({ ...present(brand), paletteExtracted: !!extractedColors?.length });
  });

  fastify.get('/:id/logo', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = request.query as { token?: string };
    let userId: string;
    try {
      userId = (fastify.jwt.verify(token || '') as any).id;
    } catch {
      return reply.status(401).send({ message: 'Token não fornecido ou inválido.' });
    }
    const brand = await prisma.brand.findFirst({ where: { id, workspace: { members: { some: { userId } } } } });
    if (!brand?.logoKey) return reply.status(404).send({ message: 'Sem logo cadastrada' });

    const full = path.join(BRANDS_DIR, brand.workspaceId, id, brand.logoKey);
    try {
      await stat(full);
    } catch {
      return reply.status(404).send({ message: 'Arquivo da logo não encontrado' });
    }
    return reply.type(brand.logoMime || 'image/png').header('Cache-Control', 'private, max-age=300').send(createReadStream(full));
  });

  fastify.delete('/:id/logo', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { workspaceId } = tenantOf(request);
    const existing = await prisma.brand.findFirst({ where: { id, workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Marca não encontrada' });

    await rm(path.join(BRANDS_DIR, workspaceId, id), { recursive: true, force: true });
    const brand = await prisma.brand.update({ where: { id }, data: { logoKey: null, logoMime: null }, include: brandInclude });
    return reply.send(present(brand));
  });
}
