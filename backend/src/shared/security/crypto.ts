import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

// AES-256-GCM. Formato armazenado: v1:<iv b64>:<tag b64>:<ciphertext b64>
function key(): Buffer {
  const raw = env.CREDENTIALS_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    throw new Error('CREDENTIALS_KEY deve ter 32 bytes (64 hex ou base64).');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('CREDENTIALS_KEY é obrigatória em produção.');
  }
  return createHash('sha256').update(`credentials:${env.JWT_SECRET}`).digest();
}

export function encryptJson(data: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptJson<T = Record<string, string>>(payload: string): T {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== 'v1') throw new Error('Formato de credencial desconhecido.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

export function maskSecret(value?: string | null): string {
  if (!value) return '—';
  if (value.includes('•')) return value; // já mascarado (dados legados do seed)
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

// Remove qualquer valor com cara de segredo antes de gravar em log/auditoria.
const SECRET_KEY_RE = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|bearer/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) && typeof v !== 'object' ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}… [truncado]`;
  return value;
}
