import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { sendEmail, sendTelegram } from '../../agent-ops/tools/delivery.js';
import { audit } from '../../shared/audit/audit.js';
import { decryptJson, encryptJson, maskSecret } from '../../shared/security/crypto.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

// Campos esperados por tipo. Os sensíveis são criptografados e nunca devolvidos;
// os "públicos" podem aparecer mascarados na listagem para o usuário reconhecer a credencial.
const TYPES: Record<string, { label: string; fields: string[]; secret: string[]; required: string[] }> = {
  login: { label: 'Login (usuário e senha)', fields: ['username', 'password'], secret: ['password'], required: ['username', 'password'] },
  api_key: { label: 'Chave de API', fields: ['apiKey'], secret: ['apiKey'], required: ['apiKey'] },
  oauth: { label: 'Token OAuth', fields: ['accessToken', 'refreshToken'], secret: ['accessToken', 'refreshToken'], required: ['accessToken'] },
  telegram_bot: { label: 'Bot do Telegram', fields: ['botToken', 'chatId'], secret: ['botToken'], required: ['botToken', 'chatId'] },
  smtp: { label: 'Servidor de e-mail (SMTP)', fields: ['host', 'port', 'secure', 'user', 'pass', 'from', 'alertTo'], secret: ['pass'], required: ['host', 'from'] },
  webhook: { label: 'Webhook de saída', fields: ['url', 'secret'], secret: ['secret'], required: ['url'] },
  mercadopago: { label: 'Mercado Pago (cobrança)', fields: ['accessToken', 'webhookSecret', 'publicKey'], secret: ['accessToken', 'webhookSecret'], required: ['accessToken'] },
};

function publicMetadata(type: string, data: Record<string, any>) {
  const spec = TYPES[type];
  const meta: Record<string, string> = {};
  for (const f of spec.fields) {
    if (data[f] == null || data[f] === '') continue;
    meta[f] = spec.secret.includes(f) ? maskSecret(String(data[f])) : String(data[f]).slice(0, 120);
  }
  return meta;
}

const Body = z.object({
  name: z.string().min(2).max(80),
  type: z.enum(Object.keys(TYPES) as [string, ...string[]]),
  data: z.record(z.any()),
});

export async function credentialRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.tenantGuard };

  fastify.get('/types', guard, async (_request, reply) => {
    return reply.send(Object.entries(TYPES).map(([id, t]) => ({ id, ...t })));
  });

  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const creds = await prisma.credential.findMany({
      where: { workspaceId, type: { not: 'browser_session' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, type: true, metadata: true, status: true, createdAt: true, updatedAt: true },
    });
    return reply.send(creds);
  });

  fastify.post('/', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const body = Body.parse(request.body);
    const spec = TYPES[body.type];
    const data = Object.fromEntries(spec.fields.filter((f) => body.data[f] != null && body.data[f] !== '').map((f) => [f, body.data[f]]));
    const missing = spec.required.filter((f) => !data[f]);
    if (missing.length) return reply.status(400).send({ message: `Campos obrigatórios: ${missing.join(', ')}` });

    const exists = await prisma.credential.findUnique({ where: { workspaceId_name: { workspaceId, name: body.name } } });
    if (exists) return reply.status(409).send({ message: 'Já existe uma credencial com esse nome.' });

    const cred = await prisma.credential.create({
      data: { workspaceId, name: body.name, type: body.type, encryptedData: encryptJson(data), metadata: publicMetadata(body.type, data) },
      select: { id: true, name: true, type: true, metadata: true, status: true, createdAt: true },
    });
    await audit(workspaceId, userId, 'credential.create', 'credential', cred.id, { name: cred.name, type: cred.type });
    return reply.status(201).send(cred);
  });

  // Substitui os dados (rotação). Campos omitidos são mantidos.
  fastify.patch('/:id', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const body = z.object({ data: z.record(z.any()).optional(), status: z.enum(['active', 'disabled']).optional() }).parse(request.body);
    const cred = await prisma.credential.findFirst({ where: { id, workspaceId } });
    if (!cred || cred.type === 'browser_session') return reply.status(404).send({ message: 'Credencial não encontrada' });

    let update: Record<string, any> = {};
    if (body.data) {
      const spec = TYPES[cred.type];
      const current = decryptJson<Record<string, any>>(cred.encryptedData);
      const incoming = Object.fromEntries(spec.fields.filter((f) => body.data![f] != null && body.data![f] !== '').map((f) => [f, body.data![f]]));
      const merged = { ...current, ...incoming };
      update = { encryptedData: encryptJson(merged), metadata: publicMetadata(cred.type, merged) };
    }
    const saved = await prisma.credential.update({
      where: { id },
      data: { ...update, ...(body.status ? { status: body.status } : {}) },
      select: { id: true, name: true, type: true, metadata: true, status: true, updatedAt: true },
    });
    await audit(workspaceId, userId, 'credential.update', 'credential', id, { rotated: !!body.data, status: body.status });
    return reply.send(saved);
  });

  fastify.delete('/:id', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const cred = await prisma.credential.findFirst({ where: { id, workspaceId } });
    if (!cred) return reply.status(404).send({ message: 'Credencial não encontrada' });
    await prisma.credential.delete({ where: { id } });
    await prisma.agent.updateMany({ where: { workspaceId, alertCredentialId: id }, data: { alertCredentialId: null } });
    await audit(workspaceId, userId, 'credential.delete', 'credential', id, { name: cred.name });
    return reply.status(204).send();
  });

  // Teste de canal: envia uma mensagem real para confirmar que a entrega funciona.
  fastify.post('/:id/test', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const cred = await prisma.credential.findFirst({ where: { id, workspaceId } });
    if (!cred) return reply.status(404).send({ message: 'Credencial não encontrada' });
    const data = decryptJson<Record<string, any>>(cred.encryptedData);
    const text = `✅ Teste de canal da Central de Agentes Simplisoft (${cred.name}).`;
    try {
      if (cred.type === 'telegram_bot') await sendTelegram(data, text, undefined, AbortSignal.timeout(20_000));
      else if (cred.type === 'smtp') await sendEmail(data, [data.alertTo || data.from], 'Teste de canal — Central de Agentes', text);
      else return reply.status(400).send({ message: 'Teste disponível apenas para Telegram e SMTP.' });
    } catch (err: any) {
      return reply.status(502).send({ message: err.message });
    }
    await audit(workspaceId, userId, 'credential.test', 'credential', id);
    return reply.send({ ok: true });
  });
}
