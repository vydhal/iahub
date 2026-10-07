import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { OPERATIONAL_TEMPLATES } from '../src/agent-ops/templates.js';
import { seedPlans } from './seed-plans.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Semeando o banco de dados...');

  // 1. Usuário padrão (Vidal Costa)
  const passwordHash = await bcrypt.hash('123456', 10);
  const user = await prisma.user.upsert({
    where: { email: 'vidal@simplisoft.com.br' },
    update: {},
    create: {
      name: 'Vidal Costa',
      email: 'vidal@simplisoft.com.br',
      passwordHash,
      role: 'ADMIN',
    },
  });

  // 2. Workspace padrão (Simplisoft)
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'simplisoft' },
    update: {},
    create: {
      name: 'Simplisoft',
      slug: 'simplisoft',
      plan: 'Studio',
      creditsTotal: 5000,
      creditsUsed: 1480,
    },
  });

  // Vincula usuário ao workspace como OWNER
  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: 'OWNER',
    },
  });

  // 3. Marca Padrão (Simplisoft)
  const brand = await prisma.brand.create({
    data: {
      workspaceId: workspace.id,
      name: 'Simplisoft',
      sector: 'Telecom & TI',
      description: 'Provedora de internet e serviços de TI para empresas, com infraestrutura própria e suporte local.',
      targetAudience: 'PMEs de 5 a 50 funcionários; gestores de clínicas, escritórios e comércio',
      preferredWords: ['estabilidade', 'continuidade', 'suporte local', 'dimensionado', 'sem interrupção'],
      bannedWords: ['revolucionário', 'disruptivo', 'mágico', 'imperdível', 'o melhor do mundo'],
      colors: {
        create: [
          { hex: '#0F3B63', usage: 'Primary', name: 'Azul Petróleo' },
          { hex: '#1E6FA8', usage: 'Secondary', name: 'Azul Claro' },
          { hex: '#C7873F', usage: 'Accent', name: 'Dourado' },
          { hex: '#101210', usage: 'Dark', name: 'Preto Corporativo' },
        ],
      },
      voices: {
        create: {
          tone: 'Profissional',
          guidelines: 'Comunicação objetiva, segura, sem jargões desnecessários.',
        },
      },
    },
  });

  // 4. Agentes de IA Padrão
  const agentsData = [
    {
      name: 'Estratégia',
      initials: 'EG',
      description: 'Define público, ângulo e proposta de valor a partir do briefing.',
      type: 'STRATEGIST' as const,
      provider: 'OpenAI',
      model: 'GPT-4o',
      temperature: '0.4',
      tools: ['brand kit', 'pesquisa interna'],
      systemPrompt: 'Você é estrategista sênior. Traduza o briefing em ângulo único, dor central e prova.',
    },
    {
      name: 'Copywriter',
      initials: 'CW',
      description: 'Escreve headline, subtítulo, CTA e legenda no tom da marca.',
      type: 'COPYWRITER' as const,
      provider: 'Anthropic',
      model: 'Claude Sonnet 4',
      temperature: '0.7',
      tools: ['tom de voz', 'palavras proibidas'],
      systemPrompt: 'Escreva copy curta e concreta. Nunca use as palavras proibidas do brand kit.',
    },
    {
      name: 'Diretor de Arte',
      initials: 'DA',
      description: 'Constrói paleta, composição, luz e enquadramento.',
      type: 'ART_DIRECTOR' as const,
      provider: 'Anthropic',
      model: 'Claude Sonnet 4',
      temperature: '0.6',
      tools: ['paleta', 'referências'],
      systemPrompt: 'Descreva direção de arte executável: composição, luz, lente, elementos.',
    },
    {
      name: 'Gerador Visual',
      initials: 'GV',
      description: 'Renderiza as peças nos formatos solicitados.',
      type: 'IMAGE_GENERATOR' as const,
      provider: 'OpenAI',
      model: 'GPT Image',
      temperature: '0.5',
      tools: ['upscale', 'variações'],
      systemPrompt: 'Gere a peça seguindo o prompt visual e reserve área de respiro para a headline.',
    },
    {
      name: 'Crítico',
      initials: 'CR',
      description: 'Avalia copy, hierarquia, contraste e aderência à marca.',
      type: 'CRITIC' as const,
      provider: 'OpenAI',
      model: 'GPT-4o',
      temperature: '0.2',
      tools: ['rubrica', 'brand kit'],
      systemPrompt: 'Avalie de 0 a 100 por categoria e aponte problemas objetivos e acionáveis.',
    },
    {
      name: 'Revisor',
      initials: 'RV',
      description: 'Aplica correções e valida a entrega final.',
      type: 'REVIEWER' as const,
      provider: 'Anthropic',
      model: 'Claude Sonnet 4',
      temperature: '0.3',
      tools: ['diff', 'checklist'],
      systemPrompt: 'Aplique apenas as correções aprovadas e registre o diff entre versões.',
    },
  ];

  for (const ag of agentsData) {
    await prisma.agent.create({
      data: {
        ...ag,
        workspaceId: workspace.id,
      },
    });
  }

  // 4b. Agente operacional do piloto (§16) — nasce em rascunho; só é ativado após teste.
  const comercial = OPERATIONAL_TEMPLATES.find((t) => t.key === 'analista_comercial')!;
  await prisma.agent.create({
    data: {
      workspaceId: workspace.id,
      kind: 'OPERATIONAL',
      status: 'DRAFT',
      name: comercial.name,
      initials: 'AC',
      description: comercial.description,
      niche: comercial.niche,
      objective: comercial.objective,
      systemPrompt: comercial.systemPrompt,
      provider: comercial.provider,
      model: comercial.model,
      temperature: '0.3',
      toolIds: comercial.toolIds,
      playbook: comercial.playbook as any,
      autonomyLevel: comercial.autonomyLevel,
      scheduleType: comercial.scheduleType,
      scheduleConfig: comercial.scheduleConfig as any,
      estimatedMinutesSaved: comercial.estimatedMinutesSaved,
    },
  });

  // 5. Provedores / Integrações
  await prisma.integration.createMany({
    data: [
      {
        workspaceId: workspace.id,
        provider: 'OPENAI',
        name: 'OpenAI',
        model: 'GPT-4o · GPT Image',
        endpoint: 'api.openai.com/v1',
        apiKey: 'sk-••••••••3f9a',
        statusKind: 'ok',
        statusLabel: 'CONECTADO',
        usagePct: 68,
      },
      {
        workspaceId: workspace.id,
        provider: 'ANTHROPIC',
        name: 'Anthropic',
        model: 'Claude Sonnet 4',
        endpoint: 'api.anthropic.com/v1',
        apiKey: 'sk-ant-••••••7c21',
        statusKind: 'ok',
        statusLabel: 'CONECTADO',
        usagePct: 41,
      },
    ],
  });

  // 6. Planos de cobrança
  await seedPlans(prisma);

  console.log('✅ Banco de dados semeado com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
