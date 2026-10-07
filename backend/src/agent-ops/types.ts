import { z } from 'zod';

export type AutonomyLevel = 'READ_ONLY' | 'RECOMMEND' | 'REQUIRE_APPROVAL' | 'CONTROLLED_AUTONOMY';
export const AUTONOMY_LEVELS = ['READ_ONLY', 'RECOMMEND', 'REQUIRE_APPROVAL', 'CONTROLLED_AUTONOMY'] as const;

/**
 * read   → só consulta/analisa
 * notify → entrega resultado a um canal interno do cliente (Telegram, e-mail, webhook)
 * write  → altera dados em sistema externo (publicar, preencher formulário que grava, POST/PUT/DELETE)
 */
export type ToolPermission = 'read' | 'notify' | 'write';

export const AGENT_STATUSES = ['DRAFT', 'TESTING', 'ACTIVE', 'PAUSED'] as const;
export const SCHEDULE_TYPES = ['manual', 'daily', 'weekly', 'monthly', 'cron', 'webhook'] as const;

export const PlaybookStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'id da etapa deve ser alfanumérico (ex: coletar_vendas)'),
  label: z.string().min(1),
  tool: z.string().min(1),
  input: z.record(z.any()).default({}),
  /** força aprovação humana nesta etapa, independente do tipo de ferramenta */
  requireApproval: z.boolean().optional(),
  /** a saída desta etapa é o resultado principal da execução (relatório) */
  result: z.boolean().optional(),
  /** continue = uma falha nesta etapa não interrompe as seguintes */
  onError: z.enum(['fail', 'continue']).optional(),
});
export const PlaybookSchema = z.array(PlaybookStepSchema).max(30);
export type PlaybookStep = z.infer<typeof PlaybookStepSchema>;

export interface ToolUsage {
  tokensInput?: number;
  tokensOutput?: number;
  cost?: number;
  model?: string;
  browserMs?: number;
}

export interface ToolResult {
  output: any;
  /** resumo curto e sem segredos para a linha do tempo */
  summary?: string;
  usage?: ToolUsage;
}

export interface ToolRunContext {
  workspaceId: string;
  executionId: string;
  agent: {
    id: string;
    name: string;
    objective: string | null;
    systemPrompt: string;
    provider: string;
    model: string;
    temperature: string;
    allowedDomains: string[];
  };
  /** credencial já descriptografada (somente em memória, nunca logada) */
  credential?: { id: string; name: string; type: string; data: Record<string, any> };
  signal: AbortSignal;
  log: (message: string, data?: Record<string, unknown>) => Promise<void>;
}

export interface ToolDefinition<I = any> {
  name: string;
  label: string;
  description: string;
  category: 'coleta' | 'rpa' | 'inteligência' | 'dados' | 'entrega' | 'teste';
  inputSchema: z.ZodType<I, z.ZodTypeDef, any>;
  /** exemplo de input exibido no catálogo da UI */
  example: Record<string, unknown>;
  /** tipos de credencial aceitos (quando a ferramenta usa `credential`) */
  credentialTypes?: string[];
  permission: (input: I) => ToolPermission;
  run: (input: I, ctx: ToolRunContext) => Promise<ToolResult>;
}
