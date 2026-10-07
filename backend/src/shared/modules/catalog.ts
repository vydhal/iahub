import type { Workspace } from '@prisma/client';

/**
 * Módulos contratáveis. O superadmin liga/desliga por cliente; o bloqueio vale na API
 * (esconder o menu no frontend não é controle de acesso).
 */
export const MODULES = [
  { key: 'carrossel', label: 'Editor de posts', description: 'Criação de carrosséis, roteiro com IA e exportação.' },
  { key: 'biblioteca', label: 'Biblioteca de mídia', description: 'Uploads, peças exportadas e reuso de imagens.' },
  { key: 'marcas', label: 'Marcas (brand kits)', description: 'Identidade, tom de voz e palavras proibidas.' },
  { key: 'campanhas', label: 'Estúdio de campanhas', description: 'Briefing, esteira de agentes criativos e projetos.' },
  { key: 'agentes', label: 'Central de Agentes', description: 'Agentes operacionais, execuções e aprovações.' },
  { key: 'agendador', label: 'Agendador de posts', description: 'Programar publicações e entregas por canal.' },
  { key: 'integracoes', label: 'Integrações de IA', description: 'Provedores e chaves de modelos.' },
  { key: 'cobranca', label: 'Cobrança', description: 'Plano, consumo e faturas do cliente.' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

/** Conjunto mínimo entregue a qualquer cliente novo. */
export const DEFAULT_MODULES: ModuleKey[] = ['carrossel', 'biblioteca', 'marcas', 'cobranca'];

export function modulesOf(workspace: Pick<Workspace, 'modules'>): Record<ModuleKey, boolean> {
  const stored = (workspace.modules || {}) as Record<string, boolean>;
  const hasConfig = Object.keys(stored).length > 0;
  return Object.fromEntries(
    MODULE_KEYS.map((k) => [k, hasConfig ? stored[k] === true : DEFAULT_MODULES.includes(k)]),
  ) as Record<ModuleKey, boolean>;
}

export function moduleEnabled(workspace: Pick<Workspace, 'modules'>, key: ModuleKey) {
  return modulesOf(workspace)[key] === true;
}

export function normalizeModules(input: Record<string, unknown>): Record<ModuleKey, boolean> {
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, input[k] === true])) as Record<ModuleKey, boolean>;
}
