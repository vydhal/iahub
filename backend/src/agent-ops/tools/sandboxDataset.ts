import { z } from 'zod';
import { ToolDefinition } from '../types.js';

// Modo de teste (diretriz §32): permite validar o playbook de ponta a ponta antes de existir acesso
// ao sistema real do cliente. Os registros são gerados e SEMPRE rotulados como exemplo — nunca devem
// ser apresentados como operação real.

const Input = z.object({
  dataset: z.enum(['vendas_exemplo', 'marketing_exemplo']),
});
type SandboxInput = z.infer<typeof Input>;

const AVISO = 'DADOS DE EXEMPLO — gerados para teste, não representam a operação real do cliente.';

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function vendas() {
  const rnd = seeded(Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')));
  const vendedores = ['Vendedor A', 'Vendedor B', 'Vendedor C', 'Vendedor D', 'Vendedor E', 'Vendedor F'];
  const canais = ['WhatsApp', 'Site', 'Indicação', 'Telefone'];
  const records = [];
  for (let i = 0; i < 60; i++) {
    const convertido = rnd() < 0.22;
    records.push({
      id: `L${1000 + i}`,
      vendedor: vendedores[Math.floor(rnd() * vendedores.length)],
      canal: canais[Math.floor(rnd() * canais.length)],
      status: convertido ? 'ganho' : rnd() < 0.3 ? 'sem_contato' : 'em_negociacao',
      valor: convertido ? Math.round(900 + rnd() * 5200) : 0,
      horas_sem_contato: Math.round(rnd() * 48),
    });
  }
  return records;
}

function marketing() {
  const rnd = seeded(Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')) + 7);
  const formatos = ['Reel', 'Carrossel', 'Post', 'Story'];
  return Array.from({ length: 24 }, (_, i) => ({
    id: `P${i + 1}`,
    formato: formatos[Math.floor(rnd() * formatos.length)],
    alcance: Math.round(800 + rnd() * 9000),
    engajamento: Math.round(40 + rnd() * 900),
    salvamentos: Math.round(rnd() * 120),
    tema: ['bastidores', 'dica técnica', 'depoimento', 'oferta', 'institucional'][Math.floor(rnd() * 5)],
  }));
}

export const sandboxDatasetTool: ToolDefinition<SandboxInput> = {
  name: 'sandbox.dataset',
  label: 'Dados de exemplo (teste)',
  description: 'Gera um conjunto de dados de exemplo, rotulado como tal, para testar o playbook antes de conectar o sistema real do cliente.',
  category: 'teste',
  inputSchema: Input,
  example: { dataset: 'vendas_exemplo' },
  permission: () => 'read',
  async run(input) {
    const records = input.dataset === 'vendas_exemplo' ? vendas() : marketing();
    return { output: { aviso: AVISO, records }, summary: `${records.length} registros de exemplo (${input.dataset})` };
  },
};
