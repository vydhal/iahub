import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { decryptJson } from '../security/crypto.js';

export type ProviderKind = 'openai' | 'anthropic';

/** Chave global (.env) da plataforma é usável, isto é, não é o placeholder de desenvolvimento. */
export function globalKeyUsable(kind: ProviderKind): boolean {
  const key = kind === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  return !!key && !key.includes('dummy');
}

/** Existe alguma chave de verdade (global ou do workspace) para chamar o provedor? */
export async function hasUsableKey(workspaceId: string, kind: ProviderKind): Promise<boolean> {
  if (env.AI_MOCK_MODE) return false;
  if (globalKeyUsable(kind)) return true;
  return !!(await resolveWorkspaceKey(workspaceId, kind));
}

function matchesKind(haystack: string, kind: ProviderKind) {
  return kind === 'anthropic' ? haystack.includes('anthropic') || haystack.includes('claude') : haystack.includes('openai') || haystack.includes('gpt');
}

/**
 * Chave própria do workspace para o provedor, cadastrada em Integrações (Config → API Keys).
 * Permite que cada cliente traga e pague sua própria chave de IA, em vez de depender da chave
 * global da plataforma (.env). Devolve null quando o workspace não tem chave própria configurada
 * ou quando o valor salvo é só um placeholder mascarado (seed de demonstração).
 */
export async function resolveWorkspaceKey(workspaceId: string, kind: ProviderKind): Promise<string | null> {
  const integrations = await prisma.integration.findMany({ where: { workspaceId } });
  const match = integrations.find((i) => !!i.apiKey && matchesKind(`${i.provider} ${i.name}`.toLowerCase(), kind));
  if (!match?.apiKey) return null;

  if (match.apiKey.startsWith('enc:')) {
    try {
      const key = decryptJson<{ apiKey: string }>(match.apiKey.slice(4)).apiKey;
      return key && !key.includes('•') ? key : null;
    } catch {
      return null;
    }
  }

  // Valor legado não criptografado (seed de demonstração) — se parece mascarado, não é uma chave usável.
  return match.apiKey.includes('•') ? null : match.apiKey;
}
