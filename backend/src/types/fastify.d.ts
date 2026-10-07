import 'fastify';
import type { TenantContext } from '../shared/tenancy/tenant.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
    /** preHandlers padrão para rotas de dados do workspace: JWT + resolução do tenant */
    tenantGuard: any[];
    /** preHandlers para rotas de um módulo contratável: JWT + tenant + módulo liberado */
    moduleGuard: (key: string) => any[];
  }
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}
