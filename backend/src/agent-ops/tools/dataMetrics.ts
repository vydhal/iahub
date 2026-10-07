import { z } from 'zod';
import { InterventionError } from '../errors.js';
import { ToolDefinition } from '../types.js';

// Cálculo determinístico de indicadores. Os números do relatório vêm daqui, não do modelo de IA —
// a IA interpreta, mas não "calcula de cabeça".

const Metric = z.object({
  name: z.string(),
  op: z.enum(['sum', 'avg', 'count', 'min', 'max', 'countDistinct', 'ratio']),
  field: z.string().optional(),
  /** para ratio: nomes de outras métricas */
  numerator: z.string().optional(),
  denominator: z.string().optional(),
  percent: z.boolean().optional(),
  /** filtro simples: só registros onde field == value */
  where: z.object({ field: z.string(), equals: z.any() }).optional(),
});

const Input = z.object({
  records: z.any(),
  metrics: z.array(Metric).min(1),
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  top: z.number().int().min(1).max(100).optional(),
  /** alerta quando uma métrica do grupo fica abaixo do limite (ex: meta diária) */
  thresholds: z.array(z.object({ metric: z.string(), below: z.number(), label: z.string() })).optional(),
});
type MetricsInput = z.infer<typeof Input>;

function num(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function compute(rows: any[], metrics: MetricsInput['metrics']) {
  const out: Record<string, number> = {};
  for (const m of metrics.filter((x) => x.op !== 'ratio')) {
    const subset = m.where ? rows.filter((r) => r?.[m.where!.field] === m.where!.equals) : rows;
    const values = m.field ? subset.map((r) => num(r?.[m.field!])) : [];
    switch (m.op) {
      case 'sum': out[m.name] = values.reduce((a, b) => a + b, 0); break;
      case 'avg': out[m.name] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; break;
      case 'count': out[m.name] = subset.length; break;
      case 'min': out[m.name] = values.length ? Math.min(...values) : 0; break;
      case 'max': out[m.name] = values.length ? Math.max(...values) : 0; break;
      case 'countDistinct': out[m.name] = new Set(subset.map((r) => r?.[m.field!])).size; break;
    }
  }
  for (const m of metrics.filter((x) => x.op === 'ratio')) {
    const d = out[m.denominator || ''] || 0;
    const v = d ? (out[m.numerator || ''] || 0) / d : 0;
    out[m.name] = m.percent ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

export const dataMetricsTool: ToolDefinition<MetricsInput> = {
  name: 'data.metrics',
  label: 'Calcular indicadores',
  description: 'Calcula totais, médias, taxas e ranking por grupo (ex: por vendedor) sobre os dados coletados, e sinaliza quem ficou abaixo da meta.',
  category: 'dados',
  inputSchema: Input,
  example: {
    records: '{{steps.coletar.output}}',
    groupBy: 'vendedor',
    metrics: [
      { name: 'vendas', op: 'count' },
      { name: 'faturamento', op: 'sum', field: 'valor' },
      { name: 'ticket_medio', op: 'avg', field: 'valor' },
    ],
    sortBy: 'faturamento',
    thresholds: [{ metric: 'faturamento', below: 5000, label: 'abaixo da meta diária' }],
  },
  permission: () => 'read',

  async run(input) {
    const rows = Array.isArray(input.records) ? input.records : Array.isArray(input.records?.records) ? input.records.records : null;
    if (!rows) throw new InterventionError('data.metrics esperava uma lista de registros — verifique a etapa de coleta.');

    const totals = compute(rows, input.metrics);
    let groups: Array<Record<string, any>> = [];
    const alerts: string[] = [];

    if (input.groupBy) {
      const buckets = new Map<string, any[]>();
      for (const r of rows) {
        const key = String(r?.[input.groupBy] ?? '—');
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(r);
      }
      groups = [...buckets.entries()].map(([key, list]) => ({ [input.groupBy!]: key, ...compute(list, input.metrics) }));
      if (input.sortBy) groups.sort((a, b) => (b[input.sortBy!] || 0) - (a[input.sortBy!] || 0));
      for (const t of input.thresholds || []) {
        const below = groups.filter((g) => (g[t.metric] ?? 0) < t.below);
        if (below.length) alerts.push(`${below.length} ${input.groupBy}(s) ${t.label}: ${below.map((g) => g[input.groupBy!]).join(', ')}`);
      }
      if (input.top) groups = groups.slice(0, input.top);
    }

    return {
      output: { count: rows.length, totals, groups, alerts },
      summary: `${rows.length} registros · ${Object.keys(totals).length} indicadores${groups.length ? ` · ${groups.length} grupos` : ''}${alerts.length ? ` · ${alerts.length} alerta(s)` : ''}`,
    };
  },
};
