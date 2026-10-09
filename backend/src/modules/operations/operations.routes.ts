import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/prisma.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';

function startOfToday(tz = 'America/Sao_Paulo') {
  const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // America/Sao_Paulo é UTC-3 sem horário de verão desde 2019
  return new Date(`${isoDate}T00:00:00-03:00`);
}

/**
 * Indicadores da Central de Agentes (diretriz §19) + visão de gestão:
 * volume, qualidade (taxa de sucesso), consumo e tempo manual economizado (ROI).
 */
export async function operationsRoutes(fastify: FastifyInstance) {
  fastify.get('/summary', { preHandler: fastify.tenantGuard }, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const today = startOfToday();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
    const prod = { workspaceId, sandbox: false };

    const [agents, todayGroups, pendingApprovals, monthAgg, weekDaily, completedMonthByAgent, recentFailures] = await Promise.all([
      prisma.agent.findMany({ where: { workspaceId, kind: 'OPERATIONAL' }, select: { id: true, name: true, status: true, estimatedMinutesSaved: true } }),
      prisma.agentExecution.groupBy({ by: ['status'], where: { ...prod, queuedAt: { gte: today } }, _count: { _all: true } }),
      prisma.approvalRequest.count({ where: { workspaceId, status: 'pending' } }),
      prisma.agentExecution.aggregate({
        where: { workspaceId, queuedAt: { gte: monthStart } },
        _sum: { cost: true, tokensInput: true, tokensOutput: true, actionsCount: true },
        _count: { _all: true },
      }),
      prisma.$queryRaw<Array<{ day: Date; completed: bigint; failed: bigint; total: bigint }>>`
        SELECT date_trunc('day', "queuedAt" AT TIME ZONE 'America/Sao_Paulo') AS day,
               COUNT(*) FILTER (WHERE status = 'completed') AS completed,
               COUNT(*) FILTER (WHERE status = 'failed') AS failed,
               COUNT(*) AS total
        FROM agent_executions
        WHERE "workspaceId" = ${workspaceId} AND sandbox = false AND "queuedAt" >= ${weekAgo}
        GROUP BY 1 ORDER BY 1`,
      prisma.agentExecution.groupBy({
        by: ['agentId'],
        where: { ...prod, status: 'completed', queuedAt: { gte: monthStart } },
        _count: { _all: true },
        _sum: { cost: true },
      }),
      prisma.agentExecution.findMany({
        where: { ...prod, status: 'failed', queuedAt: { gte: weekAgo } },
        orderBy: { queuedAt: 'desc' },
        take: 5,
        select: { id: true, error: true, errorKind: true, queuedAt: true, agent: { select: { name: true } } },
      }),
    ]);

    const count = (s: string) => todayGroups.find((g) => g.status === s)?._count._all ?? 0;
    const totalToday = todayGroups.reduce((n, g) => n + g._count._all, 0);
    const minutesByAgent = new Map(agents.map((a) => [a.id, a.estimatedMinutesSaved]));
    const nameByAgent = new Map(agents.map((a) => [a.id, a.name]));
    const minutesSavedMonth = completedMonthByAgent.reduce((n, g) => n + g._count._all * (minutesByAgent.get(g.agentId) || 0), 0);

    const days = weekDaily.map((d) => ({ day: d.day, completed: Number(d.completed), failed: Number(d.failed), total: Number(d.total) }));
    const weekCompleted = days.reduce((n, d) => n + d.completed, 0);
    const weekFailed = days.reduce((n, d) => n + d.failed, 0);

    return reply.send({
      agentsActive: agents.filter((a) => a.status === 'ACTIVE').length,
      agentsTotal: agents.length,
      executionsToday: totalToday,
      completedToday: count('completed'),
      failedToday: count('failed'),
      runningNow: count('running') + count('queued'),
      waitingApproval: pendingApprovals,
      month: {
        executions: monthAgg._count._all,
        cost: Math.round((monthAgg._sum.cost || 0) * 10000) / 10000,
        tokens: (monthAgg._sum.tokensInput || 0) + (monthAgg._sum.tokensOutput || 0),
        actions: monthAgg._sum.actionsCount || 0,
        hoursSaved: Math.round((minutesSavedMonth / 60) * 10) / 10,
      },
      successRate7d: weekCompleted + weekFailed ? Math.round((weekCompleted / (weekCompleted + weekFailed)) * 100) : null,
      last7Days: days,
      topAgents: completedMonthByAgent
        .map((g) => ({
          agentId: g.agentId,
          name: nameByAgent.get(g.agentId) || '—',
          completed: g._count._all,
          cost: g._sum.cost || 0,
          hoursSaved: Math.round(((g._count._all * (minutesByAgent.get(g.agentId) || 0)) / 60) * 10) / 10,
        }))
        .sort((a, b) => b.hoursSaved - a.hoursSaved)
        .slice(0, 5),
      recentFailures,
    });
  });

  // Checklist de ativação da Dashboard — cada item reflete um dado real do workspace,
  // nunca um toggle que o usuário "marca" manualmente.
  fastify.get('/onboarding', { preHandler: fastify.tenantGuard }, async (request, reply) => {
    const { workspaceId } = tenantOf(request);

    const [brandsWithIdentity, usableKey, gdrive, campaigns, carousels, members, scheduledPosts] = await Promise.all([
      prisma.brand.count({ where: { workspaceId, OR: [{ logoKey: { not: null } }, { colors: { some: {} } }] } }),
      prisma.integration.findFirst({ where: { workspaceId, apiKey: { startsWith: 'enc:' } }, select: { id: true } }),
      prisma.googleDriveConnection.findUnique({ where: { workspaceId }, select: { id: true } }),
      prisma.campaign.count({ where: { workspaceId } }),
      prisma.carouselProject.count({ where: { workspaceId } }),
      prisma.workspaceMember.count({ where: { workspaceId } }),
      prisma.scheduledPost.count({ where: { workspaceId } }),
    ]);

    const items = [
      { key: 'brand', label: 'Personalize a marca', description: 'Coloque a logo e as cores da agência.', done: brandsWithIdentity > 0, route: 'marcas' },
      { key: 'ai_key', label: 'Conecte sua chave de IA', description: 'Cada workspace paga só o que usa, direto no seu provedor.', done: !!usableKey, route: 'integracoes' },
      { key: 'gdrive', label: 'Conecte o Google Drive', description: 'Organize os arquivos do workspace automaticamente.', done: !!gdrive, route: 'integracoes' },
      { key: 'campaign', label: 'Crie sua primeira campanha', description: 'Estratégia, copy e arte geradas pelo orquestrador.', done: campaigns > 0, route: 'criar' },
      { key: 'carousel', label: 'Gere seu primeiro carrossel', description: 'Roteiro com IA e exportação em PNG/ZIP.', done: carousels > 0, route: 'carrossel' },
      { key: 'team', label: 'Convide um membro da equipe', description: 'Divida o trabalho sem dividir o login.', done: members > 1, route: 'config' },
      { key: 'schedule', label: 'Agende uma publicação', description: 'Telegram, e-mail ou webhook — sem precisar lembrar.', done: scheduledPosts > 0, route: 'agendador' },
    ];

    return reply.send({ items, completed: items.filter((i) => i.done).length, total: items.length });
  });
}
