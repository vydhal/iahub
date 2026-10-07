import type { Integration } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../shared/audit/audit.js';
import { decryptJson, encryptJson, maskSecret } from '../../shared/security/crypto.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

// A chave é gravada criptografada ("enc:" + AES-GCM) e a API só devolve a versão mascarada.
function sealKey(apiKey?: string) {
  if (apiKey == null) return undefined;
  if (apiKey === '' || apiKey === '—') return null;
  if (apiKey.includes('•')) return undefined; // valor mascarado reenviado pelo editor: mantém o atual
  return `enc:${encryptJson({ apiKey })}`;
}

function present(i: Integration) {
  let visible = i.apiKey;
  if (i.apiKey?.startsWith('enc:')) {
    try {
      visible = maskSecret(decryptJson<{ apiKey: string }>(i.apiKey.slice(4)).apiKey);
    } catch {
      visible = '•••• (ilegível)';
    }
  } else if (i.apiKey) {
    visible = maskSecret(i.apiKey);
  }
  return { ...i, apiKey: visible };
}

export async function integrationRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('integracoes') };

  fastify.get('/', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const integrations = await prisma.integration.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    return reply.send(integrations.map(present));
  });

  fastify.post('/', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const bodySchema = z.object({
      name: z.string(),
      provider: z.string().optional(),
      model: z.string().optional().default(''),
      endpoint: z.string().optional(),
      apiKey: z.string().optional(),
      usagePct: z.number().int().min(0).max(100).optional().default(0),
      statusKind: z.string().optional().default('wait'),
      statusLabel: z.string().optional().default('NÃO CONFIGURADO'),
    });

    const { apiKey, ...data } = bodySchema.parse(request.body);
    const integration = await prisma.integration.create({
      data: {
        ...data,
        apiKey: sealKey(apiKey) ?? null,
        provider: data.provider || data.name.toUpperCase().replace(/\s+/g, '_'),
        workspaceId,
      },
    });
    await audit(workspaceId, userId, 'integration.create', 'integration', integration.id, { name: integration.name });
    return reply.status(201).send(present(integration));
  });

  fastify.patch('/:id', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      name: z.string().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      endpoint: z.string().optional(),
      apiKey: z.string().optional(),
      usagePct: z.number().int().min(0).max(100).optional(),
      statusKind: z.string().optional(),
      statusLabel: z.string().optional(),
    });

    const { apiKey, ...data } = bodySchema.parse(request.body);
    const existing = await prisma.integration.findFirst({ where: { id, workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Integração não encontrada' });

    const sealed = sealKey(apiKey);
    const integration = await prisma.integration.update({ where: { id }, data: { ...data, ...(sealed !== undefined ? { apiKey: sealed } : {}) } });
    await audit(workspaceId, userId, 'integration.update', 'integration', id, { keyChanged: sealed !== undefined });
    return reply.send(present(integration));
  });

  fastify.delete('/:id', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const existing = await prisma.integration.findFirst({ where: { id, workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Integração não encontrada' });

    await prisma.integration.delete({ where: { id } });
    await audit(workspaceId, userId, 'integration.delete', 'integration', id, { name: existing.name });
    return reply.status(204).send();
  });
}
