// Resolve referências {{caminho | filtro}} dentro do input das etapas do playbook.
// Contexto disponível: input (gatilho), steps.<id> (saída de etapas anteriores), agent, now.
// Credenciais NUNCA ficam no contexto — são resolvidas pelo Tool Gateway pelo nome.

const TOKEN_RE = /\{\{\s*([^}|]+?)\s*(?:\|\s*([a-zA-Z]+)\s*)?\}\}/g;
const WHOLE_RE = /^\{\{\s*([^}|]+?)\s*(?:\|\s*([a-zA-Z]+)\s*)?\}\}$/;

function getPath(ctx: any, path: string): any {
  return path.split('.').reduce((cur, seg) => (cur == null ? undefined : cur[seg]), ctx);
}

const FILTERS: Record<string, (v: any) => any> = {
  brl: (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : v),
  int: (v) => (typeof v === 'number' ? Math.round(v).toLocaleString('pt-BR') : v),
  num: (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : v),
  pct: (v) => (typeof v === 'number' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : v),
  json: (v) => JSON.stringify(v, null, 2),
  upper: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
};

function applyFilter(value: any, filter?: string) {
  if (!filter) return value;
  const fn = FILTERS[filter];
  return fn ? fn(value) : value;
}

function stringify(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function resolveTemplates(value: any, ctx: Record<string, any>): any {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_RE);
    // "{{steps.coleta.output}}" sozinho preserva o tipo (array/objeto) em vez de virar texto
    if (whole) return applyFilter(getPath(ctx, whole[1]), whole[2]);
    return value.replace(TOKEN_RE, (_, path, filter) => stringify(applyFilter(getPath(ctx, path), filter)));
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTemplates(v, ctx)]));
  }
  return value;
}

export function buildNow(timezone: string) {
  const now = new Date();
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, ...opts }).format(now);
  const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return {
    iso: now.toISOString(),
    date: fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: fmt({ hour: '2-digit', minute: '2-digit' }),
    weekday: fmt({ weekday: 'long' }),
    isoDate,
  };
}
