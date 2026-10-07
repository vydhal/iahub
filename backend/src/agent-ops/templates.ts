import { PlaybookStep } from './types.js';

export interface OperationalTemplate {
  key: string;
  name: string;
  niche: string;
  description: string;
  objective: string;
  systemPrompt: string;
  model: string;
  provider: string;
  toolIds: string[];
  autonomyLevel: string;
  scheduleType: string;
  scheduleConfig: Record<string, unknown>;
  estimatedMinutesSaved: number;
  playbook: PlaybookStep[];
  /** alternativas de coleta para quando o sistema real for conectado */
  notes: string[];
}

const COMERCIAL: OperationalTemplate = {
  key: 'analista_comercial',
  name: 'Analista de Produtividade Comercial',
  niche: 'Comercial & Vendas',
  description: 'Coleta vendas, leads e conversões da plataforma comercial, calcula indicadores por vendedor e entrega um resumo executivo diário.',
  objective: 'Acompanhar diariamente a produtividade da equipe de vendas e sinalizar desvios de meta e leads parados.',
  systemPrompt:
    'Você é um analista comercial sênior. Escreva para a diretoria: direto, sem jargão, com números exatos vindos dos indicadores. ' +
    'Sempre separe DESTAQUES, ATENÇÃO, ANÁLISE e RECOMENDAÇÃO. Se os dados forem de exemplo, deixe isso explícito no topo.',
  model: 'Claude Opus 5',
  provider: 'Anthropic',
  toolIds: ['sandbox.dataset', 'http.request', 'browser.playwright', 'data.metrics', 'ai.analyze', 'telegram.send', 'email.send'],
  autonomyLevel: 'RECOMMEND',
  scheduleType: 'daily',
  scheduleConfig: { time: '18:00', weekdays: [1, 2, 3, 4, 5] },
  estimatedMinutesSaved: 45,
  playbook: [
    { id: 'coletar', label: 'Coletar vendas e leads do período', tool: 'sandbox.dataset', input: { dataset: 'vendas_exemplo' } },
    {
      id: 'indicadores',
      label: 'Calcular indicadores por vendedor',
      tool: 'data.metrics',
      input: {
        records: '{{steps.coletar.output.records}}',
        groupBy: 'vendedor',
        sortBy: 'faturamento',
        metrics: [
          { name: 'leads', op: 'count' },
          { name: 'vendas', op: 'count', where: { field: 'status', equals: 'ganho' } },
          { name: 'faturamento', op: 'sum', field: 'valor' },
          { name: 'leads_sem_contato', op: 'count', where: { field: 'status', equals: 'sem_contato' } },
          { name: 'conversao_pct', op: 'ratio', numerator: 'vendas', denominator: 'leads', percent: true },
        ],
        thresholds: [{ metric: 'vendas', below: 2, label: 'abaixo da meta diária de 2 vendas' }],
      },
    },
    {
      id: 'analise',
      label: 'Interpretar resultados e gerar resumo executivo',
      tool: 'ai.analyze',
      result: true,
      input: {
        instruction: 'Produza o resumo comercial do dia a partir dos indicadores. Aponte destaques, vendedores abaixo da meta, leads sem contato e uma recomendação prática.',
        data: { aviso: '{{steps.coletar.output.aviso}}', indicadores: '{{steps.indicadores.output}}' },
        format: 'Texto para Telegram (até 1.500 caracteres), iniciando por "📊 RESUMO COMERCIAL" e a data.',
      },
    },
    {
      id: 'entregar',
      label: 'Enviar resumo no Telegram',
      tool: 'telegram.send',
      onError: 'continue',
      input: { credential: 'Telegram Diretoria', text: '📊 RESUMO COMERCIAL · {{now.date}}\n\n{{steps.analise.output.text}}' },
    },
  ],
  notes: [
    'Para conectar a plataforma real, troque a etapa "coletar" por http.request (API do CRM) ou browser.playwright (RPA com login) e cadastre o domínio em Permissões.',
    'Cadastre a credencial "Telegram Diretoria" (tipo telegram_bot) em Credenciais antes de ativar.',
  ],
};

const MARKETING: OperationalTemplate = {
  key: 'analista_marketing',
  name: 'Analista de Marketing',
  niche: 'Marketing & Conteúdo',
  description: 'Monitora métricas de conteúdo, identifica padrões de desempenho, sugere calendário editorial e prepara briefings — publicação só com aprovação.',
  objective: 'Transformar métricas de redes sociais em diagnóstico semanal, calendário editorial e briefings prontos para aprovação.',
  systemPrompt:
    'Você é um estrategista de conteúdo. Baseie cada recomendação em números do período. Proponha no máximo 5 pautas, cada uma com formato, gancho e objetivo.',
  model: 'Claude Opus 5',
  provider: 'Anthropic',
  toolIds: ['sandbox.dataset', 'http.request', 'data.metrics', 'ai.analyze', 'telegram.send', 'webhook.send'],
  autonomyLevel: 'REQUIRE_APPROVAL',
  scheduleType: 'weekly',
  scheduleConfig: { time: '09:00', weekdays: [1] },
  estimatedMinutesSaved: 120,
  playbook: [
    { id: 'metricas', label: 'Coletar métricas de publicações', tool: 'sandbox.dataset', input: { dataset: 'marketing_exemplo' } },
    {
      id: 'desempenho',
      label: 'Comparar desempenho por formato',
      tool: 'data.metrics',
      input: {
        records: '{{steps.metricas.output.records}}',
        groupBy: 'formato',
        sortBy: 'engajamento_medio',
        metrics: [
          { name: 'publicacoes', op: 'count' },
          { name: 'alcance_total', op: 'sum', field: 'alcance' },
          { name: 'engajamento_medio', op: 'avg', field: 'engajamento' },
          { name: 'salvamentos', op: 'sum', field: 'salvamentos' },
        ],
      },
    },
    {
      id: 'diagnostico',
      label: 'Diagnóstico, calendário e briefings',
      tool: 'ai.analyze',
      result: true,
      input: {
        instruction: 'Identifique os formatos e temas de melhor desempenho, gere um diagnóstico curto, um calendário editorial para a próxima semana e briefings de copy para as 3 melhores pautas.',
        data: { aviso: '{{steps.metricas.output.aviso}}', desempenho: '{{steps.desempenho.output}}', publicacoes: '{{steps.metricas.output.records}}' },
      },
    },
    {
      id: 'publicar',
      label: 'Enviar calendário ao sistema de publicação',
      tool: 'webhook.send',
      requireApproval: true,
      input: { credential: 'Webhook Publicação', payload: { origem: '{{agent.name}}', semana: '{{now.isoDate}}', plano: '{{steps.diagnostico.output.text}}' } },
    },
  ],
  notes: [
    'Para métricas reais, troque "metricas" por http.request na Graph API da Meta (credencial oauth) e autorize graph.facebook.com.',
    'A etapa "publicar" sempre exige aprovação humana (Aprovar / Rejeitar / Editar).',
  ],
};

export const OPERATIONAL_TEMPLATES = [COMERCIAL, MARKETING];
