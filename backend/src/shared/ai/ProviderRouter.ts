import { env } from '../../config/env.js';
import { AIProvider } from './interfaces/AIProvider.js';
import { globalKeyUsable, resolveWorkspaceKey } from './keyResolver.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { MockAIProvider } from './providers/MockAIProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';

function kindOf(requestedProvider?: string): 'anthropic' | 'openai' {
  const p = (requestedProvider || '').toLowerCase();
  return p.includes('anthropic') || p.includes('claude') ? 'anthropic' : 'openai';
}

export class ProviderRouter {
  private mockProvider = new MockAIProvider();
  private openAIProvider = new OpenAIProvider();
  private anthropicProvider = new AnthropicProvider();

  /** Sempre usa a chave global da plataforma (.env). Mantido para quem não tem workspace em mãos. */
  getProvider(requestedProvider?: string): AIProvider {
    if (env.AI_MOCK_MODE) {
      return this.mockProvider;
    }
    return kindOf(requestedProvider) === 'anthropic' ? this.anthropicProvider : this.openAIProvider;
  }

  /**
   * Resolve o provider priorizando a chave própria do workspace (cadastrada em Config → API Keys /
   * Integrações) — cada cliente pode trazer e pagar sua própria chave de IA. Sem chave própria,
   * cai para a chave global da plataforma (.env).
   */
  async getProviderForWorkspace(requestedProvider: string | undefined, workspaceId: string): Promise<AIProvider> {
    if (env.AI_MOCK_MODE) {
      return this.mockProvider;
    }
    const kind = kindOf(requestedProvider);
    const ownKey = await resolveWorkspaceKey(workspaceId, kind);
    if (ownKey) {
      return kind === 'anthropic' ? new AnthropicProvider(ownKey) : new OpenAIProvider(ownKey);
    }
    if (!globalKeyUsable(kind)) {
      const label = kind === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI';
      throw new Error(`Nenhuma chave de IA configurada para ${label}. Cadastre a sua em Configurações → Integrações.`);
    }
    return kind === 'anthropic' ? this.anthropicProvider : this.openAIProvider;
  }
}

export const providerRouter = new ProviderRouter();
