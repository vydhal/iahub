import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { FastifyInstance } from 'fastify';
import { workspaceForMcpToken } from '../modules/integrations/mcp.routes.js';
import { buildMcpServerForWorkspace } from './server.js';

/**
 * Servidor MCP remoto do workspace (Streamable HTTP, modo stateless — cada requisição cria e
 * fecha seu próprio McpServer, sem sessão em memória). Autenticação própria via Bearer token
 * gerado em Configurações → Integrações → Conectar IA (MCP) — não usa o JWT normal da sessão,
 * porque quem bate aqui é o cliente MCP (Claude Desktop/Code), não o navegador do usuário.
 */
export async function mcpRoutes(fastify: FastifyInstance) {
  fastify.post('/', async (request, reply) => {
    const auth = request.headers.authorization;
    const raw = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!raw) return reply.status(401).send({ error: 'missing_token', message: 'Envie o token em Authorization: Bearer <token>.' });

    const workspaceId = await workspaceForMcpToken(raw);
    if (!workspaceId) return reply.status(401).send({ error: 'invalid_token', message: 'Token de MCP inválido ou revogado.' });

    const server = buildMcpServerForWorkspace(workspaceId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.hijack();
    reply.raw.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
