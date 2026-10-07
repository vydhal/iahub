import { env } from '../../config/env.js';
import { AIProvider } from './interfaces/AIProvider.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { MockAIProvider } from './providers/MockAIProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';

export class ProviderRouter {
  private mockProvider = new MockAIProvider();
  private openAIProvider = new OpenAIProvider();
  private anthropicProvider = new AnthropicProvider();

  getProvider(requestedProvider?: string): AIProvider {
    if (env.AI_MOCK_MODE) {
      return this.mockProvider;
    }

    const p = (requestedProvider || '').toLowerCase();

    if (p.includes('anthropic') || p.includes('claude')) {
      return this.anthropicProvider;
    }

    if (p.includes('openai') || p.includes('gpt')) {
      return this.openAIProvider;
    }

    // Fallback padrão se não especificado
    return this.openAIProvider;
  }
}

export const providerRouter = new ProviderRouter();
