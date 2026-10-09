import { createHash } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../shared/audit/audit.js';
import { randomToken } from '../../shared/security/crypto.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function workspaceForMcpToken(rawToken: string): Promise<string | null> {
  const tokenHash = hashMcpToken(rawToken);
  const record = await prisma.mcpToken.findUnique({ where: { tokenHash } });
  if (!record) return null;
  prisma.mcpToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return record.workspaceId;
}

export async function mcpTokenRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('integracoes') };

  fastify.get('/token', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const token = await prisma.mcpToken.findUnique({ where: { workspaceId } });
    if (!token) return reply.send({ connected: false });
    return reply.send({ connected: true, label: token.label, createdAt: token.createdAt, lastUsedAt: token.lastUsedAt });
  });

  // Gera (ou substitui) o token — o valor cru só existe nesta resposta, nunca mais é lido de volta.
  fastify.post('/token', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const raw = `mcp_${randomToken(32)}`;
    const tokenHash = hashMcpToken(raw);
    await prisma.mcpToken.upsert({
      where: { workspaceId },
      create: { workspaceId, tokenHash },
      update: { tokenHash, createdAt: new Date(), lastUsedAt: null },
    });
    await audit(workspaceId, userId, 'integration.mcp.token_created', 'mcp_token', workspaceId, {});
    return reply.status(201).send({ token: raw });
  });

  fastify.delete('/token', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const existing = await prisma.mcpToken.findUnique({ where: { workspaceId } });
    if (!existing) return reply.status(404).send({ message: 'Nenhum token para revogar.' });
    await prisma.mcpToken.delete({ where: { workspaceId } });
    await audit(workspaceId, userId, 'integration.mcp.token_revoked', 'mcp_token', workspaceId, {});
    return reply.status(204).send();
  });
}
