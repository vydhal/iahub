import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { env } from '../config/env.js';
import { PolicyError } from './errors.js';

/** Normaliza entradas da allowlist: "https://crm.empresa.com.br/x" → "crm.empresa.com.br" */
export function normalizeDomain(entry: string): string {
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed;
  }
}

export function hostAllowed(hostname: string, allowedDomains: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedDomains
    .map(normalizeDomain)
    .filter(Boolean)
    .some((d) => host === d || host.endsWith(`.${d}`));
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/**
 * Valida uma URL antes de qualquer acesso de rede feito por um agente:
 * protocolo http(s), domínio na allowlist do agente e (por padrão) bloqueio de redes privadas —
 * evita que uma automação alcance Postgres/Redis/API internos (SSRF).
 */
export async function assertAllowedUrl(rawUrl: string, allowedDomains: string[] | null): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PolicyError(`URL inválida: ${rawUrl}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PolicyError(`Protocolo não permitido: ${url.protocol}`);
  }
  if (allowedDomains) {
    if (!allowedDomains.length) {
      throw new PolicyError('O agente não possui domínios autorizados. Cadastre a allowlist em Permissões.');
    }
    if (!hostAllowed(url.hostname, allowedDomains)) {
      throw new PolicyError(`Domínio fora da allowlist do agente: ${url.hostname}`);
    }
  }
  if (!env.ALLOW_PRIVATE_NETWORK) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!addresses.length && !net.isIP(host)) {
      // Falha de DNS é tratada pela própria requisição (erro recuperável de rede).
      return url;
    }
    if (addresses.some(isPrivateIp)) {
      throw new PolicyError(`Acesso a rede privada bloqueado (${url.hostname}). Defina ALLOW_PRIVATE_NETWORK=true apenas em ambientes controlados.`);
    }
  }
  return url;
}
