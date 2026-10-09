import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { agentRoutes } from './modules/agents/agents.routes.js';
import { approvalRoutes } from './modules/approvals/approvals.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { carouselRoutes } from './modules/carousel/carousel.routes.js';
import { brandRoutes } from './modules/brands/brands.routes.js';
import { campaignRoutes } from './modules/campaigns/campaigns.routes.js';
import { creativeRoutes } from './modules/creatives/creatives.routes.js';
import { credentialRoutes } from './modules/credentials/credentials.routes.js';
import { executionRoutes } from './modules/executions/executions.routes.js';
import { hookRoutes } from './modules/hooks/hooks.routes.js';
import { googleDriveRoutes } from './modules/integrations/googleDrive.routes.js';
import { instagramRoutes } from './modules/integrations/instagram.routes.js';
import { integrationRoutes } from './modules/integrations/integrations.routes.js';
import { mcpTokenRoutes } from './modules/integrations/mcp.routes.js';
import { mcpRoutes } from './mcp/mcp.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { operationsRoutes } from './modules/operations/operations.routes.js';
import { platformRoutes } from './modules/platform/platform.routes.js';
import { schedulerRoutes } from './modules/scheduler/scheduler.routes.js';
import { usageRoutes } from './modules/usage/usage.routes.js';
import { workspaceRoutes } from './modules/workspaces/workspaces.routes.js';
import { requireModule, resolveTenant } from './shared/tenancy/tenant.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  // CORS
  app.register(fastifyCors, {
    origin: '*',
    credentials: true,
  });

  // JWT
  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  app.register(fastifyCookie);

  // Upload de imagens do editor de posts (até 10 MB por arquivo).
  app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  // Decorator de Autenticação
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ message: 'Token não fornecido ou inválido.' });
    }
  });

  // JWT + tenant: toda rota de dados do workspace usa este par de preHandlers.
  app.decorate('tenantGuard', [app.authenticate, resolveTenant]);
  // Guard por módulo contratado: JWT + tenant + módulo liberado para a conta.
  app.decorate('moduleGuard', (key: any) => [app.authenticate, resolveTenant, requireModule(key)]);

  // Erros de validação viram 400 legível em vez de 500.
  app.setErrorHandler((error: any, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      });
    }
    request.log.error(error);
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    return reply.status(status).send({ message: status === 500 ? 'Erro interno do servidor.' : error.message });
  });

  // Healthcheck
  app.get('/health', async () => {
    return { status: 'ok', environment: env.NODE_ENV, mockMode: env.AI_MOCK_MODE };
  });

  // Registro de Rotas da API
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(workspaceRoutes, { prefix: '/api/workspaces' });
  app.register(brandRoutes, { prefix: '/api/brands' });
  app.register(campaignRoutes, { prefix: '/api/campaigns' });
  app.register(creativeRoutes, { prefix: '/api/creatives' });
  app.register(agentRoutes, { prefix: '/api/agents' });
  app.register(integrationRoutes, { prefix: '/api/integrations' });
  app.register(googleDriveRoutes, { prefix: '/api/integrations/google-drive' });
  app.register(instagramRoutes, { prefix: '/api/integrations/instagram' });
  app.register(mcpTokenRoutes, { prefix: '/api/integrations/mcp' });
  app.register(mcpRoutes, { prefix: '/api/mcp' });
  app.register(usageRoutes, { prefix: '/api/usage' });

  // Agent Operations Center
  app.register(executionRoutes, { prefix: '/api/executions' });
  app.register(approvalRoutes, { prefix: '/api/approvals' });
  app.register(credentialRoutes, { prefix: '/api/credentials' });
  app.register(operationsRoutes, { prefix: '/api/operations' });
  app.register(auditRoutes, { prefix: '/api/audit' });
  app.register(hookRoutes, { prefix: '/api/hooks' });

  // Editor de posts e cobrança
  app.register(mediaRoutes, { prefix: '/api/media' });
  app.register(carouselRoutes, { prefix: '/api/carousel' });
  app.register(billingRoutes, { prefix: '/api/billing' });
  app.register(schedulerRoutes, { prefix: '/api/scheduled-posts' });

  // Administração da plataforma (Simplisoft)
  app.register(adminRoutes, { prefix: '/api/admin' });
  // Identidade visual: pública, porque aparece antes do login
  app.register(platformRoutes, { prefix: '/api/platform' });

  return app;
}
