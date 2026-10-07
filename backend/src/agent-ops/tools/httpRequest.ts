import { z } from 'zod';
import { InterventionError, RecoverableError } from '../errors.js';
import { assertAllowedUrl } from '../network.js';
import { ToolDefinition } from '../types.js';

const MAX_BODY = 200_000;

const Input = z.object({
  url: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  credential: z.string().optional(),
  auth: z.enum(['none', 'bearer', 'basic', 'header']).default('none'),
  authHeader: z.string().default('X-API-Key'),
  /** caminho para extrair só uma parte do JSON de resposta (ex: "data.items") */
  pick: z.string().optional(),
  timeoutSec: z.number().int().min(1).max(120).default(30),
});
type HttpInput = z.infer<typeof Input>;

function pickPath(data: any, path?: string) {
  if (!path) return data;
  return path.split('.').reduce((cur, seg) => (cur == null ? undefined : cur[seg]), data);
}

export const httpRequestTool: ToolDefinition<HttpInput> = {
  name: 'http.request',
  label: 'Requisição HTTP / API',
  description: 'Consulta APIs REST do cliente. Preferir sempre API a RPA. Métodos diferentes de GET são tratados como ação de escrita.',
  category: 'coleta',
  inputSchema: Input,
  credentialTypes: ['api_key', 'oauth', 'login'],
  example: { url: 'https://api.suaempresa.com.br/v1/vendas', method: 'GET', query: { data: '{{now.isoDate}}' }, credential: 'API Vendas', auth: 'bearer', pick: 'data' },
  permission: (input) => (input.method === 'GET' ? 'read' : 'write'),

  async run(input, ctx) {
    const url = await assertAllowedUrl(input.url, ctx.agent.allowedDomains);
    for (const [k, v] of Object.entries(input.query || {})) url.searchParams.set(k, String(v));

    const headers: Record<string, string> = { Accept: 'application/json', ...(input.headers || {}) };
    const cred = ctx.credential?.data;
    if (input.auth !== 'none' && !cred) throw new InterventionError('Autenticação configurada, mas nenhuma credencial vinculada à etapa.');
    if (input.auth === 'bearer') headers.Authorization = `Bearer ${cred?.accessToken || cred?.apiKey || cred?.token}`;
    if (input.auth === 'basic') headers.Authorization = `Basic ${Buffer.from(`${cred?.username}:${cred?.password}`).toString('base64')}`;
    if (input.auth === 'header') headers[input.authHeader] = String(cred?.apiKey || cred?.token || '');

    let body: string | undefined;
    if (input.body !== undefined && input.method !== 'GET') {
      body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(input.timeoutSec * 1000)]);

    // Redirecionamentos seguidos manualmente para revalidar cada destino na allowlist.
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(current, { method: input.method, headers, body, signal, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = await assertAllowedUrl(new URL(res.headers.get('location')!, current).toString(), ctx.agent.allowedDomains);
        continue;
      }
      break;
    }
    if (!res) throw new RecoverableError('Sem resposta do servidor.');

    const text = (await res.text()).slice(0, MAX_BODY);
    if (res.status === 401 || res.status === 403) {
      throw new InterventionError(`Acesso negado (${res.status}) em ${current.hostname} — verifique a credencial.`);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new RecoverableError(`${current.hostname} respondeu ${res.status}.`);
    }
    if (res.status >= 400) {
      throw new InterventionError(`${current.hostname} respondeu ${res.status}: ${text.slice(0, 300)}`);
    }

    let data: any = text;
    if ((res.headers.get('content-type') || '').includes('json')) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new InterventionError('Resposta JSON inválida — o formato da API pode ter mudado.');
      }
    }
    const picked = pickPath(data, input.pick);
    const size = Array.isArray(picked) ? `${picked.length} registros` : `${text.length} bytes`;
    return {
      output: picked,
      summary: `${input.method} ${current.hostname}${current.pathname} → ${res.status} (${size})`,
    };
  },
};
