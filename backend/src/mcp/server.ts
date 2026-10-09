import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { generateScript } from '../modules/carousel/carousel.service.js';
import { orchestratorService } from '../shared/orchestrator/OrchestratorService.js';

function text(payload: unknown) {
  return { content: [{ type: 'text' as const, text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }] };
}

function errorText(err: any) {
  return { isError: true, content: [{ type: 'text' as const, text: err?.message || 'Erro desconhecido.' }] };
}

/**
 * Um McpServer novo por requisição (modo stateless — ver mcpRoutes), já preso a um workspace
 * resolvido pelo token de MCP. Cada tool é um wrapper fino sobre o mesmo Prisma/orquestrador
 * usado pelo resto da API — nenhuma lógica de negócio duplicada aqui.
 */
export function buildMcpServerForWorkspace(workspaceId: string): McpServer {
  const server = new McpServer({ name: 'ai-creative-studio', version: '1.0.0' });

  server.registerTool(
    'list_brands',
    { title: 'Listar marcas', description: 'Lista as marcas (brand kits) cadastradas neste workspace.', inputSchema: {} },
    async () => {
      const brands = await prisma.brand.findMany({ where: { workspaceId }, select: { id: true, name: true, sector: true, description: true } });
      return text(brands);
    },
  );

  server.registerTool(
    'list_campaigns',
    {
      title: 'Listar campanhas',
      description: 'Lista as campanhas mais recentes do workspace, com status.',
      inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
    },
    async ({ limit }) => {
      const campaigns = await prisma.campaign.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, name: true, status: true, objective: true, createdAt: true },
      });
      return text(campaigns);
    },
  );

  server.registerTool(
    'get_campaign',
    { title: 'Detalhar campanha', description: 'Mostra o resultado completo de uma campanha (copy, direção de arte, imagens, notas do crítico).', inputSchema: { campaignId: z.string() } },
    async ({ campaignId }) => {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, workspaceId },
        include: { brand: true, creatives: { include: { versions: { include: { assets: true } } } } },
      });
      if (!campaign) return errorText(new Error('Campanha não encontrada neste workspace.'));
      return text(campaign);
    },
  );

  server.registerTool(
    'create_campaign',
    {
      title: 'Criar campanha',
      description:
        'Cria uma campanha e roda o orquestrador (estratégia → copy → direção de arte → imagem → crítica) de forma síncrona, devolvendo o resultado pronto. Pode demorar alguns segundos.',
      inputSchema: {
        description: z.string().describe('Briefing da campanha: o que divulgar, para quem, com que objetivo.'),
        brandName: z.string().optional(),
        objective: z.string().optional(),
        audience: z.string().optional(),
        tone: z.string().optional(),
        contentType: z.string().optional(),
        format: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const brand = await prisma.brand.findFirst({ where: { workspaceId, name: args.brandName || 'Simplisoft' } });
        const campaign = await prisma.campaign.create({
          data: {
            workspaceId,
            brandId: brand?.id,
            name: `Campanha - ${args.description.slice(0, 40)}`,
            description: args.description,
            objective: args.objective || 'Gerar leads',
            audience: args.audience || 'Donos de pequenas empresas',
            tone: args.tone || 'Profissional',
            contentType: args.contentType || 'Campanha completa',
            format: args.format || '1080 × 1080',
            status: 'PROCESSING',
          },
        });
        const result = await orchestratorService.executeCampaignWorkflow(campaign.id);
        return text({ campaignId: campaign.id, ...result.context.copy, images: result.context.images, review: result.context.review });
      } catch (err: any) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    'generate_carousel_script',
    {
      title: 'Gerar roteiro de carrossel',
      description: 'Gera o roteiro (slides) de um carrossel com IA, a partir de um tema.',
      inputSchema: {
        topic: z.string(),
        count: z.number().int().min(3).max(12).default(8),
        tone: z.string().optional(),
        audience: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const res = await generateScript({ workspaceId, ...args });
        return text(res);
      } catch (err: any) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    'list_agent_executions',
    {
      title: 'Listar execuções de agentes',
      description: 'Mostra as execuções mais recentes dos agentes operacionais do workspace (status, custo, erro).',
      inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
    },
    async ({ limit }) => {
      const executions = await prisma.agentExecution.findMany({
        where: { workspaceId },
        orderBy: { queuedAt: 'desc' },
        take: limit,
        select: { id: true, status: true, cost: true, error: true, queuedAt: true, finishedAt: true, agent: { select: { name: true } } },
      });
      return text(executions);
    },
  );

  return server;
}
