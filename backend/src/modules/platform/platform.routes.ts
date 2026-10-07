import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';

export const PLATFORM_DIR = path.resolve(process.cwd(), 'storage', 'platform');

export async function platformSettings() {
  return prisma.platformSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
}

/** Identidade usada na tela de login e no cabeçalho — pública por natureza (aparece antes do login). */
export async function platformRoutes(fastify: FastifyInstance) {
  fastify.get('/branding', async (_request, reply) => {
    const s = await platformSettings();
    const demo = env.NODE_ENV === 'development' ? await prisma.user.findFirst({ where: { email: 'vidal@simplisoft.com.br', active: true }, select: { email: true } }) : null;
    return reply.send({
      productName: s.productName,
      tagline: s.tagline,
      loginHeadline: s.loginHeadline,
      loginMessage: s.loginMessage,
      supportEmail: s.supportEmail,
      accentColor: s.accentColor,
      logoUrl: s.logoPath ? `/api/platform/logo?v=${s.updatedAt.getTime()}` : null,
      demoEmail: demo?.email || null,
    });
  });

  fastify.get('/logo', async (_request, reply) => {
    const s = await platformSettings();
    if (!s.logoPath) return reply.status(404).send({ message: 'Sem logo cadastrada' });
    const full = path.join(PLATFORM_DIR, s.logoPath);
    try {
      await stat(full);
    } catch {
      return reply.status(404).send({ message: 'Arquivo da logo não encontrado' });
    }
    const ext = path.extname(s.logoPath).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    return reply.type(mime).header('Cache-Control', 'public, max-age=300').send(createReadStream(full));
  });
}

const LOGO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export async function saveLogo(buffer: Buffer, mimeType: string) {
  const ext = LOGO_EXT[mimeType];
  if (!ext) throw new Error(`Formato não suportado: ${mimeType}. Use PNG, JPG, WEBP ou SVG.`);
  if (buffer.byteLength > 2 * 1024 * 1024) throw new Error('A logo deve ter no máximo 2 MB.');
  await mkdir(PLATFORM_DIR, { recursive: true });
  const file = `logo.${ext}`;
  await writeFile(path.join(PLATFORM_DIR, file), buffer);
  return prisma.platformSettings.upsert({
    where: { id: 'singleton' },
    update: { logoPath: file },
    create: { id: 'singleton', logoPath: file },
  });
}
