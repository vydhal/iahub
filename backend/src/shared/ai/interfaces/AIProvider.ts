import { z } from 'zod';

export interface TextGenerationOptions {
  model?: string;
  temperature?: number;
  systemPrompt?: string;
}

export interface ImageGenerationOptions {
  model?: string;
  prompt: string;
  count?: number;
  width?: number;
  height?: number;
}

export interface ImageAnalysisOptions {
  model?: string;
  imageUrl: string;
  prompt: string;
}

export interface AIProviderResult<T = any> {
  data: T;
  tokensInput: number;
  tokensOutput: number;
  estimatedCost: number;
  rawText?: string;
}

export interface AIProvider {
  name: string;
  generateText(prompt: string, options?: TextGenerationOptions): Promise<AIProviderResult<string>>;
  generateStructured<T>(prompt: string, schema: z.ZodSchema<T>, options?: TextGenerationOptions): Promise<AIProviderResult<T>>;
  generateImage(options: ImageGenerationOptions): Promise<AIProviderResult<string[]>>;
  analyzeImage(options: ImageAnalysisOptions): Promise<AIProviderResult<string>>;
}
