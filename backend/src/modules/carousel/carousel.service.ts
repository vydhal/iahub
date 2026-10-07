import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { costOf, resolveModel } from '../../shared/ai/models.js';
import { providerRouter } from '../../shared/ai/ProviderRouter.js';

export const LAYOUTS = ['capa', 'texto', 'dado', 'citacao', 'foto', 'cta', 'checklist', 'antes', 'caso'] as const;

export const SlideSchema = z.object({
  id: z.string().optional(),
  layout: z.enum(LAYOUTS).default('texto'),
  theme: z.string().default('navy'),
  title: z.string().default(''),
  body: z.string().default(''),
  bullets: z.string().default(''),
  stat: z.string().default(''),
  statLabel: z.string().default(''),
  quote: z.string().default(''),
  author: z.string().default(''),
  cta: z.string().default(''),
  before: z.string().default(''),
  after: z.string().default(''),
  prompt: z.string().default(''),
  image: z.string().default(''),
  imgMode: z.string().default('bloco'),
  imgOpacity: z.number().default(100),
  imgScrim: z.number().default(55),
  imgH: z.number().default(420),
  imgRadius: z.number().default(2),
  // enquadramento da imagem (arrastar a foto dentro da moldura)
  imgX: z.number().default(50),
  imgY: z.number().default(50),
  // deslocamento de cada elemento no modo "mover elementos": { title:{x,y}, body:{x,y}, ... }
  pos: z.record(z.object({ x: z.number(), y: z.number() })).default({}),
  listFirst: z.boolean().default(false),
  align: z.string().default('left'),
});
export type Slide = z.infer<typeof SlideSchema>;

// Saída pedida ao modelo: só o conteúdo editorial; estilo e imagem ficam com o editor.
const DeckSchema = z.object({
  slides: z
    .array(
      z.object({
        layout: z.enum(LAYOUTS),
        title: z.string().default(''),
        body: z.string().default(''),
        bullets: z.string().default(''),
        stat: z.string().default(''),
        statLabel: z.string().default(''),
        quote: z.string().default(''),
        author: z.string().default(''),
        cta: z.string().default(''),
        before: z.string().default(''),
        after: z.string().default(''),
      }),
    )
    .min(2),
});

const THEME_CYCLE = ['dark', 'navy', 'dark', 'light', 'navy'];

function withDefaults(raw: Partial<Slide>, index: number): Slide {
  return SlideSchema.parse({
    ...raw,
    id: raw.id || Math.random().toString(36).slice(2, 9),
    theme: raw.theme || (index === 0 ? 'dark' : THEME_CYCLE[index % THEME_CYCLE.length]),
    imgMode: raw.imgMode || (raw.layout === 'capa' ? 'fundo' : 'bloco'),
  });
}

/** Esqueleto honesto para o modo simulado: estrutura real, conteúdo visivelmente por preencher. */
function mockDeck(topic: string, count: number): Slide[] {
  const slides: Partial<Slide>[] = [
    { layout: 'capa', title: topic || 'Tema do carrossel', body: '⚠️ Roteiro simulado — configure uma chave de IA para gerar o texto real.' },
  ];
  for (let i = 1; i < count - 1; i++) {
    slides.push({
      layout: i % 4 === 3 ? 'dado' : 'texto',
      title: `Argumento ${i} sobre ${topic || 'o tema'}`,
      body: 'Modo simulado (AI_MOCK_MODE=true): nenhum modelo foi chamado. Escreva aqui ou ligue uma chave de IA real.',
      ...(i % 4 === 3 ? { stat: '—', statLabel: 'dado a preencher' } : {}),
    });
  }
  slides.push({ layout: 'cta', title: 'Chamada final', body: 'Conclusão a escrever.', cta: 'Comenta *PALAVRA* que eu te mando o material.' });
  return slides.slice(0, count).map((s, i) => withDefaults(s, i));
}

export async function generateScript(opts: {
  workspaceId: string;
  topic: string;
  count: number;
  tone?: string;
  brandName?: string;
  audience?: string;
}): Promise<{ slides: Slide[]; mock: boolean; note: string }> {
  const count = Math.min(12, Math.max(3, opts.count));
  if (env.AI_MOCK_MODE) {
    return {
      slides: mockDeck(opts.topic, count),
      mock: true,
      note: 'Modo simulado: estrutura criada sem chamar IA. Defina ANTHROPIC_API_KEY/OPENAI_API_KEY e AI_MOCK_MODE=false para roteiro real.',
    };
  }

  const brand = await prisma.brand.findFirst({ where: { workspaceId: opts.workspaceId }, include: { voices: true } });
  const model = resolveModel('Claude Opus 5', 'anthropic');
  const provider = providerRouter.getProvider(model.provider);

  const prompt = `Você é ROTEIRISTA DE CARROSSEL para Instagram/LinkedIn.
Tema: "${opts.topic}"
Quantidade de slides: ${count} (o primeiro é 'capa', o último é 'cta')
Marca: ${opts.brandName || brand?.name || 'não informada'} — setor ${brand?.sector || 'não informado'}
Público: ${opts.audience || brand?.targetAudience || 'não informado'}
Tom de voz: ${opts.tone || brand?.voices?.[0]?.tone || 'profissional e direto'}
Palavras proibidas: ${brand?.bannedWords?.join(', ') || 'nenhuma'}

Regras:
- Use os layouts: capa, texto, dado, citacao, checklist, antes, caso, cta.
- Envolva em asteriscos a expressão que deve receber destaque visual, ex: "o problema é *processo*". No máximo um destaque por frase.
- 'bullets', 'before' e 'after' são listas com um item por linha (\\n).
- Em 'dado', 'stat' é o número e 'statLabel' o rótulo curto.
- Frases curtas, sem jargão e sem promessa exagerada. Nada de dados inventados: se não houver número real, não use o layout 'dado'.
- Responda apenas com JSON no formato {"slides":[...]}.`;

  const res = await provider.generateStructured(prompt, DeckSchema, { model: model.id, temperature: 0.7 });

  await prisma.usageRecord.create({
    data: {
      workspaceId: opts.workspaceId,
      provider: model.provider,
      model: model.id,
      operation: 'carousel_script',
      tokensInput: res.tokensInput,
      tokensOutput: res.tokensOutput,
      estimatedCost: res.estimatedCost || costOf(model, res.tokensInput, res.tokensOutput),
    },
  });

  return {
    slides: res.data.slides.slice(0, count).map((s, i) => withDefaults(s as Partial<Slide>, i)),
    mock: false,
    note: `Roteiro gerado com ${model.id}.`,
  };
}

/** Prompt de imagem (em inglês) para um slide — o usuário pode gerar aqui ou levar para outra ferramenta. */
export async function generateImagePrompt(opts: {
  workspaceId: string;
  slide: Partial<Slide>;
  style: string;
  composition: string;
  format: string;
  deckTitles: string[];
}): Promise<{ prompt: string; mock: boolean }> {
  const conteudo = [opts.slide.title, opts.slide.body, opts.slide.quote, opts.slide.stat, opts.slide.statLabel, opts.slide.bullets]
    .filter(Boolean)
    .join(' · ')
    .replace(/\*/g, '');

  if (env.AI_MOCK_MODE) {
    const base = [opts.style, opts.composition, opts.format].filter(Boolean).join(', ');
    return {
      prompt: `[MODO SIMULADO] ${base}. Scene illustrating: ${conteudo.slice(0, 200)}. No text, no logos, negative space for headline.`,
      mock: true,
    };
  }

  const model = resolveModel('Claude Sonnet 5', 'anthropic');
  const provider = providerRouter.getProvider(model.provider);
  const ask = `Escreva UM prompt de geração de imagem em inglês (60-90 palavras) para ilustrar este slide de carrossel.
Conteúdo do slide: "${conteudo}". Tipo: ${opts.slide.layout}. Outros slides: "${opts.deckTitles.slice(0, 4).join(' / ')}".
Estilo: ${opts.style}. Composição: ${opts.composition}. Formato: ${opts.format}.
Obrigatório: espaço negativo para o texto do slide, sem texto e sem logotipo na imagem, sem pessoas sorrindo para a câmera.
Responda somente com o prompt.`;

  const res = await provider.generateText(ask, { model: model.id, temperature: 0.6 });
  await prisma.usageRecord.create({
    data: {
      workspaceId: opts.workspaceId,
      provider: model.provider,
      model: model.id,
      operation: 'carousel_image_prompt',
      tokensInput: res.tokensInput,
      tokensOutput: res.tokensOutput,
      estimatedCost: res.estimatedCost,
    },
  });
  return { prompt: res.data.trim(), mock: false };
}
