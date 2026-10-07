// Tradução dos rótulos exibidos na UI ("Claude Sonnet 4", "GPT-4o"...) para IDs reais de API
// e preço por 1M tokens (entrada/saída, US$) usado na contabilização de consumo.

export interface ResolvedModel {
  provider: 'anthropic' | 'openai';
  id: string;
  inputPerM: number;
  outputPerM: number;
  /** modelos Claude 5 rejeitam temperature/top_p com 400 */
  acceptsTemperature: boolean;
}

export function resolveModel(label?: string | null, providerHint?: string | null): ResolvedModel {
  const l = (label || '').toLowerCase();
  const p = (providerHint || '').toLowerCase();

  if (l.includes('opus')) return { provider: 'anthropic', id: 'claude-opus-5', inputPerM: 5, outputPerM: 25, acceptsTemperature: false };
  if (l.includes('haiku')) return { provider: 'anthropic', id: 'claude-haiku-4-5', inputPerM: 1, outputPerM: 5, acceptsTemperature: true };
  if (l.includes('sonnet')) return { provider: 'anthropic', id: 'claude-sonnet-5', inputPerM: 2, outputPerM: 10, acceptsTemperature: false };
  if (l.startsWith('claude-')) return { provider: 'anthropic', id: l, inputPerM: 5, outputPerM: 25, acceptsTemperature: false };
  if (l.includes('mini')) return { provider: 'openai', id: 'gpt-4o-mini', inputPerM: 0.15, outputPerM: 0.6, acceptsTemperature: true };
  if (l.includes('gpt')) return { provider: 'openai', id: 'gpt-4o', inputPerM: 2.5, outputPerM: 10, acceptsTemperature: true };

  // Sem rótulo reconhecido: usa o provedor informado; padrão Claude Opus 5.
  if (p.includes('openai')) return { provider: 'openai', id: 'gpt-4o', inputPerM: 2.5, outputPerM: 10, acceptsTemperature: true };
  return { provider: 'anthropic', id: 'claude-opus-5', inputPerM: 5, outputPerM: 25, acceptsTemperature: false };
}

export function costOf(model: ResolvedModel, tokensInput: number, tokensOutput: number) {
  return (tokensInput * model.inputPerM + tokensOutput * model.outputPerM) / 1_000_000;
}
