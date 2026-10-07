import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';
import { verifyMediaSignature } from '../scheduler/scheduler.service.js';

export const MEDIA_DIR = path.resolve(process.cwd(), 'storage', 'media');

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

const MAX_BYTES = 10 * 1024 * 1024;

export async function saveBuffer(workspaceId: string, buffer: Buffer, mimeType: string, name: string, origin: string) {
  if (!EXT[mimeType]) throw new Error(`Tipo de arquivo não suportado: ${mimeType}`);
  if (buffer.byteLength > MAX_BYTES) throw new Error('Arquivo maior que 10 MB.');

  const asset = await prisma.mediaAsset.create({
    data: { workspaceId, name: name.slice(0, 120), mimeType, size: buffer.byteLength, storageKey: 'pending', origin },
  });
  const key = path.join(workspaceId, `${asset.id}.${EXT[mimeType]}`);
  await mkdir(path.join(MEDIA_DIR, workspaceId), { recursive: true });
  await writeFile(path.join(MEDIA_DIR, key), buffer);
  return prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey: key } });
}

export async function mediaRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('biblioteca') };

  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(60) }).parse(request.query);
    const assets = await prisma.mediaAsset.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: limit });
    return reply.send(assets.map((a) => ({ ...a, url: `/api/media/${a.id}/file` })));
  });

  // Upload multipart (tela do editor: importar imagem)
  fastify.post('/', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const file = await (request as any).file({ limits: { fileSize: MAX_BYTES } });
    if (!file) return reply.status(400).send({ message: 'Nenhum arquivo enviado.' });
    const buffer = await file.toBuffer();
    try {
      const asset = await saveBuffer(workspaceId, buffer, file.mimetype, file.filename || 'imagem', String(file.fields?.origin?.value || 'upload'));
      return reply.status(201).send({ ...asset, url: `/api/media/${asset.id}/file` });
    } catch (err: any) {
      return reply.status(400).send({ message: err.message });
    }
  });

  // Upload de data URL (exportação do canvas / imagem gerada)
  fastify.post('/data-url', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const body = z.object({ dataUrl: z.string().min(16), name: z.string().default('peça'), origin: z.string().default('export') }).parse(request.body);
    const match = body.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return reply.status(400).send({ message: 'dataUrl inválida.' });
    try {
      const asset = await saveBuffer(workspaceId, Buffer.from(match[2], 'base64'), match[1], body.name, body.origin);
      return reply.status(201).send({ ...asset, url: `/api/media/${asset.id}/file` });
    } catch (err: any) {
      return reply.status(400).send({ message: err.message });
    }
  });

  // Arquivo em si: <img>/CSS não enviam header, então o JWT vem em ?token= (mesmo padrão do SSE).
  fastify.get('/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token, exp, sig } = request.query as { token?: string; exp?: string; sig?: string };
    // Dois caminhos: sessão do usuário (?token=) ou link assinado e temporário (?exp=&sig=),
    // usado quando o agendador entrega as imagens para a automação do cliente.
    let asset = null;
    if (sig && exp) {
      if (!verifyMediaSignature(id, exp, sig)) return reply.status(401).send({ message: 'Link expirado ou inválido.' });
      asset = await prisma.mediaAsset.findUnique({ where: { id } });
    } else {
      let userId: string;
      try {
        userId = (fastify.jwt.verify(token || '') as any).id;
      } catch {
        return reply.status(401).send({ message: 'Token não fornecido ou inválido.' });
      }
      asset = await prisma.mediaAsset.findFirst({ where: { id, workspace: { members: { some: { userId } } } } });
    }
    if (!asset) return reply.status(404).send({ message: 'Arquivo não encontrado' });

    const full = path.join(MEDIA_DIR, asset.storageKey);
    try {
      await stat(full);
    } catch {
      return reply.status(404).send({ message: 'Arquivo ausente no armazenamento' });
    }
    return reply.type(asset.mimeType).header('Cache-Control', 'private, max-age=86400').send(createReadStream(full));
  });

  fastify.delete('/:id', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const asset = await prisma.mediaAsset.findFirst({ where: { id, workspaceId } });
    if (!asset) return reply.status(404).send({ message: 'Arquivo não encontrado' });
    await prisma.mediaAsset.delete({ where: { id } });
    await unlink(path.join(MEDIA_DIR, asset.storageKey)).catch(() => {});
    return reply.status(204).send();
  });
}
