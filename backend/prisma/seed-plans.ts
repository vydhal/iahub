import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Catálogo inicial de planos. Valores são uma base comercial editável na tabela `plans`
// (preço, créditos inclusos e preço do crédito excedente) — nada aqui é cobrado sem gateway conectado.
export const PLANS = [
  {
    code: 'essencial',
    name: 'Essencial',
    description: 'Para começar com um agente operacional e o estúdio de conteúdo.',
    priceCents: 29700,
    creditsIncluded: 1000,
    overageCentsPerCredit: 45,
    maxAgents: 2,
    maxBrands: 1,
    maxScheduledPosts: 30,
    modules: ['carrossel', 'biblioteca', 'marcas', 'agendador', 'cobranca'],
    sortOrder: 1,
    features: ['Editor de posts e biblioteca', '1 marca', '1.000 créditos por mês', 'Agendador de publicações', 'Suporte por e-mail'],
  },
  {
    code: 'studio',
    name: 'Studio',
    description: 'Operação com vários agentes, RPA e aprovação humana.',
    priceCents: 69700,
    creditsIncluded: 3000,
    overageCentsPerCredit: 35,
    maxAgents: 8,
    maxBrands: 5,
    maxScheduledPosts: 150,
    modules: ['carrossel', 'biblioteca', 'marcas', 'agendador', 'campanhas', 'agentes', 'cobranca'],
    sortOrder: 2,
    features: ['Tudo do Essencial', 'Estúdio de campanhas', '8 agentes operacionais', 'Até 5 marcas', 'Suporte prioritário'],
  },
  {
    code: 'scale',
    name: 'Scale',
    description: 'Volume alto, integrações sob medida e acompanhamento dedicado.',
    priceCents: 149700,
    creditsIncluded: 8000,
    overageCentsPerCredit: 25,
    maxAgents: 0,
    maxBrands: 0,
    maxScheduledPosts: 1000,
    modules: ['carrossel', 'biblioteca', 'marcas', 'agendador', 'campanhas', 'agentes', 'integracoes', 'cobranca'],
    sortOrder: 3,
    features: ['Tudo do Studio', 'Agentes e marcas ilimitados', 'Integrações de IA próprias', 'Gestor de conta dedicado', 'SLA de atendimento'],
  },
];

export async function seedPlans(client: PrismaClient = prisma) {
  for (const plan of PLANS) {
    await client.plan.upsert({ where: { code: plan.code }, update: plan, create: plan });
  }
  return PLANS.length;
}

// Execução direta: npx tsx prisma/seed-plans.ts
if (process.argv[1] && process.argv[1].includes('seed-plans')) {
  seedPlans()
    .then((n) => console.log(`✅ ${n} planos sincronizados`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
