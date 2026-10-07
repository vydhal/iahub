import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { AIProvider, AIProviderResult, ImageAnalysisOptions, ImageGenerationOptions, TextGenerationOptions } from '../interfaces/AIProvider.js';

export class OpenAIProvider implements AIProvider {
  name = 'OpenAIProvider';
  private client: OpenAI | null = null;

  /** `apiKeyOverride`: chave própria do workspace (Integrações). Sem ela, usa a chave global da plataforma. */
  constructor(apiKeyOverride?: string) {
    const apiKey = apiKeyOverride || env.OPENAI_API_KEY;
    if (apiKey && !env.AI_MOCK_MODE) {
      this.client = new OpenAI({ apiKey });
    }
  }

  async generateText(prompt: string, options?: TextGenerationOptions): Promise<AIProviderResult<string>> {
    if (!this.client) {
      throw new Error('OpenAI API Key não configurada ou sistema rodando em MOCK mode.');
    }

    const response = await this.client.chat.completions.create({
      model: options?.model || 'gpt-4o',
      temperature: options?.temperature ?? 0.5,
      messages: [
        ...(options?.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
        { role: 'user' as const, content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content || '';
    const tokensInput = response.usage?.prompt_tokens || 0;
    const tokensOutput = response.usage?.completion_tokens || 0;

    return {
      data: content,
      tokensInput,
      tokensOutput,
      estimatedCost: (tokensInput * 0.005 + tokensOutput * 0.015) / 1000,
      rawText: content,
    };
  }

  async generateStructured<T>(prompt: string, schema: z.ZodSchema<T>, options?: TextGenerationOptions): Promise<AIProviderResult<T>> {
    if (!this.client) {
      throw new Error('OpenAI API Key não configurada ou sistema rodando em MOCK mode.');
    }

    const promptWithJsonInstruction = `${prompt}\n\nATENÇÃO: Responda estritamente em formato JSON válido. Não inclua bloco de codigo markdown.`;

    const result = await this.generateText(promptWithJsonInstruction, options);
    
    try {
      const cleanJson = (result.rawText || '').replace(/```json/g, '').replace(/```/g, '').trim() || '{}';
      const parsedData = schema.parse(JSON.parse(cleanJson));
      return {
        ...result,
        data: parsedData,
      };
    } catch (err: any) {
      console.warn('Erro ao parsear JSON estruturado OpenAI:', err);
      throw new Error(`OpenAI retornou JSON inválido: ${err.message}`);
    }
  }

  async generateImage(options: ImageGenerationOptions): Promise<AIProviderResult<string[]>> {
    if (!this.client) {
      throw new Error('OpenAI API Key não configurada ou sistema rodando em MOCK mode.');
    }

    const count = options.count || 1;
    const urls: string[] = [];

    for (let i = 0; i < count; i++) {
      const response = await this.client.images.generate({
        model: options.model || 'dall-e-3',
        prompt: options.prompt,
        n: 1,
        size: '1080x1080' as any,
      });
      const imageUrl = response.data?.[0]?.url;
      if (imageUrl) {
        urls.push(imageUrl);
      }
    }

    return {
      data: urls,
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCost: count * 0.04,
    };
  }

  async analyzeImage(options: ImageAnalysisOptions): Promise<AIProviderResult<string>> {
    if (!this.client) {
      throw new Error('OpenAI API Key não configurada ou sistema rodando em MOCK mode.');
    }

    const response = await this.client.chat.completions.create({
      model: options.model || 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: options.prompt },
            { type: 'image_url', image_url: { url: options.imageUrl } },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content || '';
    return {
      data: content,
      tokensInput: response.usage?.prompt_tokens || 0,
      tokensOutput: response.usage?.completion_tokens || 0,
      estimatedCost: 0.01,
    };
  }
}
