import type { Agent } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { decryptJson } from '../shared/security/crypto.js';
import { InterventionError, PolicyError, classifyUnknownError } from './errors.js';
import { ExecutionLogger } from './logger.js';
import { toolRegistry } from './tools/registry.js';
import { AutonomyLevel, PlaybookStep, ToolDefinition, ToolPermission, ToolResult } from './types.js';

export type Decision =
  | { mode: 'execute'; permission: ToolPermission }
  | { mode: 'approval'; permission: ToolPermission; reason: string }
  | { mode: 'skip'; permission: ToolPermission; reason: string; recommendation: boolean }
  | { mode: 'simulate'; permission: ToolPermission; reason: string };

export interface UsageTotals {
  tokensInput: number;
  tokensOutput: number;
  cost: number;
  model?: string;
  browserMs: number;
  actions: number;
  tools: Record<string, number>;
}

/**
 * Tool Gateway: único caminho entre o agente e o mundo externo.
 * - só libera ferramentas vinculadas ao agente;
 * - aplica a política de autonomia (leitura / recomendação / aprovação / autonomia controlada);
 * - resolve credenciais do próprio tenant, em memória, fora de prompt e de log;
 * - impõe limite de ações e contabiliza consumo.
 */
export class ToolGateway {
  usage: UsageTotals = { tokensInput: 0, tokensOutput: 0, cost: 0, browserMs: 0, actions: 0, tools: {} };

  constructor(
    private agent: Agent,
    private executionId: string,
    private sandbox: boolean,
    private logger: ExecutionLogger,
    initialActions = 0,
  ) {
    this.usage.actions = initialActions;
  }

  tool(name: string): ToolDefinition {
    const tool = toolRegistry.get(name);
    if (!tool) throw new InterventionError(`Ferramenta desconhecida no playbook: ${name}`);
    if (!this.agent.toolIds.includes(name)) {
      throw new PolicyError(`Ferramenta "${name}" não está liberada para este agente (aba Ferramentas).`);
    }
    return tool;
  }

  decide(step: PlaybookStep, tool: ToolDefinition, input: unknown, approved: boolean): Decision {
    const permission = tool.permission(input);
    const autonomy = this.agent.autonomyLevel as AutonomyLevel;
    const wantsApproval = !!step.requireApproval || permission === 'write';

    if (this.sandbox && (permission !== 'read' || step.requireApproval)) {
      return { mode: 'simulate', permission, reason: 'Modo teste: ação com efeito externo não executada.' };
    }
    if (permission === 'read' && !step.requireApproval) return { mode: 'execute', permission };

    switch (autonomy) {
      case 'READ_ONLY':
        return { mode: 'skip', permission, recommendation: permission === 'write', reason: 'Agente em modo somente leitura — resultado disponível no painel.' };
      case 'RECOMMEND':
        if (permission === 'notify' && !step.requireApproval) return { mode: 'execute', permission };
        return { mode: 'skip', permission, recommendation: true, reason: 'Agente em modo recomendação — ação registrada como sugestão, não executada.' };
      case 'REQUIRE_APPROVAL':
        if (!wantsApproval || approved) return { mode: 'execute', permission };
        return { mode: 'approval', permission, reason: permission === 'write' ? 'Ação altera dados externos.' : 'Etapa marcada para aprovação.' };
      case 'CONTROLLED_AUTONOMY':
        if (!step.requireApproval || approved) return { mode: 'execute', permission };
        return { mode: 'approval', permission, reason: 'Etapa marcada para aprovação.' };
      default:
        throw new PolicyError(`Nível de autonomia inválido: ${autonomy}`);
    }
  }

  private async credentialFor(tool: ToolDefinition, name?: string) {
    if (!name) return undefined;
    const cred = await prisma.credential.findUnique({
      where: { workspaceId_name: { workspaceId: this.agent.workspaceId!, name } },
    });
    if (!cred || cred.status !== 'active') throw new InterventionError(`Credencial "${name}" não encontrada ou inativa neste workspace.`);
    if (tool.credentialTypes?.length && !tool.credentialTypes.includes(cred.type)) {
      throw new InterventionError(`Credencial "${name}" é do tipo ${cred.type}; ${tool.name} aceita ${tool.credentialTypes.join(', ')}.`);
    }
    return { id: cred.id, name: cred.name, type: cred.type, data: decryptJson<Record<string, any>>(cred.encryptedData) };
  }

  async call(step: PlaybookStep, tool: ToolDefinition, input: any, signal: AbortSignal): Promise<ToolResult> {
    this.usage.actions += 1;
    if (this.usage.actions > this.agent.maxActions) {
      throw new PolicyError(`Limite de ${this.agent.maxActions} ações por execução atingido.`);
    }
    const started = Date.now();
    try {
      // Dentro do try: credencial ausente/inválida também precisa aparecer na linha do tempo.
      const credential = await this.credentialFor(tool, input?.credential);
      const result = await tool.run(input, {
        workspaceId: this.agent.workspaceId!,
        executionId: this.executionId,
        agent: {
          id: this.agent.id,
          name: this.agent.name,
          objective: this.agent.objective,
          systemPrompt: this.agent.systemPrompt,
          provider: this.agent.provider,
          model: this.agent.model,
          temperature: this.agent.temperature,
          allowedDomains: this.agent.allowedDomains,
        },
        credential,
        signal,
        log: (message, data) => this.logger.info(message, { stepId: step.id, tool: tool.name, data }),
      });
      const u = result.usage || {};
      this.usage.tokensInput += u.tokensInput || 0;
      this.usage.tokensOutput += u.tokensOutput || 0;
      this.usage.cost += u.cost || 0;
      this.usage.browserMs += u.browserMs || 0;
      if (u.model) this.usage.model = u.model;
      this.usage.tools[tool.name] = (this.usage.tools[tool.name] || 0) + 1;
      await this.logger.action(`${step.label}: ${result.summary || 'concluído'}`, {
        stepId: step.id,
        tool: tool.name,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      const classified = classifyUnknownError(err);
      await this.logger.error(`${step.label}: ${classified.message}`, {
        stepId: step.id,
        tool: tool.name,
        durationMs: Date.now() - started,
        data: { kind: classified.kind },
      });
      throw classified;
    }
  }
}
