import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { AIProvider, AIProviderResult, ImageAnalysisOptions, ImageGenerationOptions, TextGenerationOptions } from '../interfaces/AIProvider.js';
import { costOf, resolveModel } from '../models.js';

export class AnthropicProvider implements AIProvider {
  name = 'AnthropicProvider';
  private client: Anthropic | null = null;

  constructor() {
    if (env.ANTHROPIC_API_KEY && !env.AI_MOCK_MODE) {
      this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    }
  }

  async generateText(prompt: string, options?: TextGenerationOptions): Promise<AIProviderResult<string>> {
    if (!this.client) {
      throw new Error('Anthropic API Key não configurada ou sistema rodando em MOCK mode.');
    }

    const model = resolveModel(options?.model || 'claude-opus-5', 'anthropic');
    const response = await this.client.messages.create({
      model: model.id,
      max_tokens: 16000,
      // Claude Opus 5 / Sonnet 5 rejeitam temperature (400) — só envia quando o modelo aceita.
      ...(model.acceptsTemperature && options?.temperature != null ? { temperature: options.temperature } : {}),
      ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
      messages: [{ role: 'user', content: prompt }],
    });

    if ((response.stop_reason as string) === 'refusal') {
      throw new Error('O modelo recusou a solicitação (stop_reason: refusal).');
    }

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    const tokensInput = response.usage.input_tokens;
    const tokensOutput = response.usage.output_tokens;

    return {
      data: text,
      tokensInput,
      tokensOutput,
      estimatedCost: costOf(model, tokensInput, tokensOutput),
      rawText: text,
    };
  }

  async generateStructured<T>(prompt: string, schema: z.ZodSchema<T>, options?: TextGenerationOptions): Promise<AIProviderResult<T>> {
    if (!this.client) {
      throw new Error('Anthropic API Key não configurada ou sistema rodando em MOCK mode.');
    }

    const promptWithJsonInstruction = `${prompt}\n\nResponda ESTRITAMENTE com um objeto JSON válido que cumpra o formato exigido. Não adicione textos adicionais antes ou depois.`;

    const result = await this.generateText(promptWithJsonInstruction, options);

    try {
      const cleanJson = result.rawText?.replace(/```json/g, '').replace(/```/g, '').trim() || '{}';
      const parsedData = schema.parse(JSON.parse(cleanJson));
      return {
        ...result,
        data: parsedData,
      };
    } catch (err: any) {
      throw new Error(`Claude retornou JSON inválido: ${err.message}`);
    }
  }

  async generateImage(options: ImageGenerationOptions): Promise<AIProviderResult<string[]>> {
    throw new Error('Anthropic Claude não suporta geração direta de imagens. Use OpenAIProvider para esta etapa.');
  }

  async analyzeImage(options: ImageAnalysisOptions): Promise<AIProviderResult<string>> {
    if (!this.client) {
      throw new Error('Anthropic API Key não configurada ou sistema rodando em MOCK mode.');
    }

    const model = resolveModel(options.model || 'claude-opus-5', 'anthropic');
    const response = await this.client.messages.create({
      model: model.id,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: options.prompt },
            {
              type: 'image',
              source: {
                type: 'url',
                url: options.imageUrl,
              } as any,
            },
          ],
        },
      ],
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    return {
      data: text,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
      estimatedCost: costOf(model, response.usage.input_tokens, response.usage.output_tokens),
    };
  }
}
