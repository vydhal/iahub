import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { saveBuffer } from '../../modules/media/media.routes.js';
import { providerRouter } from '../ai/ProviderRouter.js';

/**
 * As URLs que a OpenAI devolve para imagens geradas expiram em cerca de 1h. Baixamos o
 * conteúdo e salvamos como MediaAsset de verdade (mesmo armazenamento da Biblioteca), em vez
 * de guardar um link que vira 404 — e assim a peça também aparece na Biblioteca.
 */
async function persistGeneratedImage(workspaceId: string, remoteUrl: string, name: string) {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Falha ao baixar imagem gerada (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/png';
  const asset = await saveBuffer(workspaceId, buffer, mimeType, name, 'ai');
  return { url: `/api/media/${asset.id}/file`, storageKey: asset.storageKey, mimeType: asset.mimeType };
}

// Schemas Zod de Validação de Output Estruturado de cada Agente

export const StrategyOutputSchema = z.object({
  audience: z.string(),
  painPoint: z.string(),
  uniqueAngle: z.string(),
  proof: z.string(),
  funnelStage: z.string(),
});

export const CopyOutputSchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  cta: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
});

export const ArtDirectionOutputSchema = z.object({
  concept: z.string(),
  composition: z.string(),
  lighting: z.string(),
  framing: z.string(),
  typography: z.string(),
  elements: z.string(),
  palette: z.array(z.string()),
  imagePrompt: z.string(),
});

export const ReviewOutputSchema = z.object({
  overallScore: z.number(),
  copyScore: z.number(),
  compositionScore: z.number(),
  hierarchyScore: z.number(),
  contrastScore: z.number(),
  brandScore: z.number(),
  strengths: z.array(z.string()),
  issues: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export class OrchestratorService {
  /**
   * Executa o Workflow da Campanha ponta a ponta
   */
  async executeCampaignWorkflow(campaignId: string, progressCallback?: (step: number, label: string, data?: any) => void) {
    console.log(`🚀 Iniciando OrchestratorWorkflow para a campanha ID: ${campaignId}`);

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { brand: { include: { colors: true, voices: true } }, workspace: true },
    });

    if (!campaign) throw new Error(`Campanha ${campaignId} não encontrada`);

    // Atualiza status da campanha para PROCESSING
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'PROCESSING' },
    });

    // Cria registro da execução do workflow
    const execution = await prisma.workflowExecution.create({
      data: {
        campaignId,
        status: 'RUNNING',
        totalSteps: 7,
        currentStep: 0,
      },
    });

    // Contexto acumulativo entre agentes
    const context: any = {
      briefing: campaign.description || campaign.name,
      objective: campaign.objective,
      audience: campaign.audience,
      tone: campaign.tone,
      format: campaign.format || '1080 × 1080',
      brand: campaign.brand
        ? {
            name: campaign.brand.name,
            sector: campaign.brand.sector,
            description: campaign.brand.description,
            preferredWords: campaign.brand.preferredWords,
            bannedWords: campaign.brand.bannedWords,
          }
        : null,
    };

    let creativeVersion: any = null;

    try {
      // ----------------------------------------------------
      // STEP 1: STRATEGY (GPT-4o / OpenAI)
      // ----------------------------------------------------
      progressCallback?.(1, 'Estratégia');
      await this.updateExecutionStep(execution.id, 1, 'Estratégia', 'RUNNING');

      const provider = await providerRouter.getProviderForWorkspace('openai', campaign.workspaceId);
      const strategyPrompt = `
Você é o Agente ESTRATEGISTA do AI Creative Studio.
Analise o briefing e monte a estratégia da campanha:
Briefing: "${context.briefing}"
Objetivo: "${context.objective}"
Marca: "${context.brand?.name || 'Simplisoft'}" (Setor: ${context.brand?.sector || 'TI & Telecom'})

Monte o output em JSON com público, dor central, ângulo único, prova e estágio de funil.
`;

      const strategyRes = await provider.generateStructured(strategyPrompt, StrategyOutputSchema, {
        temperature: 0.4,
        systemPrompt: 'Você é um estrategista sênior de marketing B2B.',
      });

      context.strategy = strategyRes.data;

      await this.completeExecutionStep(execution.id, 1, 'Estratégia', 'GPT-4o', strategyRes);

      // ----------------------------------------------------
      // STEP 2: COPYWRITER (Claude Sonnet / Anthropic ou GPT)
      // ----------------------------------------------------
      progressCallback?.(2, 'Copy');
      await this.updateExecutionStep(execution.id, 2, 'Copy', 'RUNNING');

      const copyProvider = await providerRouter.getProviderForWorkspace('anthropic', campaign.workspaceId);
      const copyPrompt = `
Você é o Agente COPYWRITER do AI Creative Studio.
Com base no briefing e na estratégia abaixo, escreva as peças de copy:
Briefing: "${context.briefing}"
Estratégia:
- Público: ${context.strategy.audience}
- Dor: ${context.strategy.painPoint}
- Ângulo único: ${context.strategy.uniqueAngle}
- Prova: ${context.strategy.proof}
Tom de Voz: ${context.tone || 'Profissional'}
Palavras proibidas: ${context.brand?.bannedWords?.join(', ') || 'nenhuma'}

Crie headline impactante, subtítulo, CTA claro, legenda para post e hashtags relevantes.
`;

      const copyRes = await copyProvider.generateStructured(copyPrompt, CopyOutputSchema, {
        temperature: 0.7,
        systemPrompt: 'Você é um copywriter de elite especialista em conversão.',
      });

      context.copy = copyRes.data;

      await this.completeExecutionStep(execution.id, 2, 'Copy', 'Claude Sonnet 4', copyRes);

      // ----------------------------------------------------
      // STEP 3: ART_DIRECTOR (Claude Sonnet / Anthropic)
      // ----------------------------------------------------
      progressCallback?.(3, 'Direção criativa');
      await this.updateExecutionStep(execution.id, 3, 'Direção criativa', 'RUNNING');

      const artPrompt = `
Você é o Agente DIRETOR DE ARTE do AI Creative Studio.
Crie a direção de arte e o prompt de geração visual com base nas informações acumuladas:
Briefing: "${context.briefing}"
Headline: "${context.copy.headline}"
Conceito: "${context.strategy.uniqueAngle}"
Formato da peça: ${context.format}

Defina conceito visual, composição com respiro para texto, iluminação, enquadramento, tipografia, elementos e o prompt em inglês otimizado para geradores visuais (DALL-E 3/GPT Image).
`;

      const artRes = await copyProvider.generateStructured(artPrompt, ArtDirectionOutputSchema, {
        temperature: 0.6,
        systemPrompt: 'Você é um diretor de arte premiado de agência de publicidade.',
      });

      context.artDirection = artRes.data;

      await this.completeExecutionStep(execution.id, 3, 'Direção criativa', 'Claude Sonnet 4', artRes);

      // ----------------------------------------------------
      // STEP 4: IMAGE_GENERATION (GPT Image / OpenAI)
      // ----------------------------------------------------
      progressCallback?.(4, 'Geração visual');
      await this.updateExecutionStep(execution.id, 4, 'Geração visual', 'RUNNING');

      const imgProvider = await providerRouter.getProviderForWorkspace('openai', campaign.workspaceId);
      const imgRes = await imgProvider.generateImage({
        prompt: context.artDirection.imagePrompt,
        count: campaign.workspace?.defaultVariationCount || 4,
      });

      // Baixa e persiste cada imagem como MediaAsset de verdade (ver persistGeneratedImage) —
      // a URL da OpenAI expira em ~1h e sumiria da peça salva.
      context.images = await Promise.all(
        imgRes.data.map((url, i) => persistGeneratedImage(campaign.workspaceId, url, `${context.copy.headline.slice(0, 40)} - ${i + 1}`)),
      );

      await this.completeExecutionStep(execution.id, 4, 'Geração visual', 'GPT Image', imgRes);

      // ----------------------------------------------------
      // STEP 5: CRITIC / REVIEW (GPT-4o / Claude)
      // ----------------------------------------------------
      progressCallback?.(5, 'Avaliação');
      await this.updateExecutionStep(execution.id, 5, 'Avaliação', 'RUNNING');

      if (campaign.workspace?.autoReview === false) {
        // Autoavaliação desativada nas Preferências do workspace: pula a chamada ao Crítico.
        context.review = null;
        await this.completeExecutionStep(execution.id, 5, 'Avaliação', 'Sistema', {
          tokensInput: 0,
          tokensOutput: 0,
          estimatedCost: 0,
        });
      } else {
        const criticPrompt = `
Você é o Agente CRÍTICO de design e comunicação.
Avalie a peça de 0 a 100 nas rubricas (Copy, Composição, Hierarquia, Contraste, Marca) e forneça pontos fortes, problemas e recomendações:
Headline: "${context.copy.headline}"
Subtítulo: "${context.copy.subheadline}"
Direção de arte: "${context.artDirection.concept}"
`;

        const criticRes = await provider.generateStructured(criticPrompt, ReviewOutputSchema, {
          temperature: 0.2,
        });

        context.review = criticRes.data;

        await this.completeExecutionStep(execution.id, 5, 'Avaliação', 'GPT-4o', criticRes);
      }

      // ----------------------------------------------------
      // STEP 6: REFINEMENT (Ajustes Automáticos)
      // ----------------------------------------------------
      progressCallback?.(6, 'Refinamento');
      await this.updateExecutionStep(execution.id, 6, 'Refinamento', 'RUNNING');

      // Nenhum modelo é chamado nesta etapa hoje (o ajuste fino acontece via refineCreativeVersion,
      // sob demanda, depois que o usuário vê o resultado) — não fatura tokens/custo que não ocorreram.
      await this.completeExecutionStep(execution.id, 6, 'Refinamento', 'Sistema', {
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCost: 0,
      });

      // ----------------------------------------------------
      // STEP 7: FINALIZATION (Salvar tudo no Banco de Dados)
      // ----------------------------------------------------
      progressCallback?.(7, 'Finalização');
      await this.updateExecutionStep(execution.id, 7, 'Finalização', 'RUNNING');

      // Cria a peça Creative
      const creative = await prisma.creative.create({
        data: {
          campaignId,
          name: `Peça Principal - ${context.copy.headline.slice(0, 30)}...`,
          format: campaign.format || '1080 × 1080',
        },
      });

      // Salva a versão imutável V1
      creativeVersion = await prisma.creativeVersion.create({
        data: {
          creativeId: creative.id,
          versionNumber: 1,
          headline: context.copy.headline,
          subheadline: context.copy.subheadline,
          cta: context.copy.cta,
          caption: context.copy.caption,
          hashtags: context.copy.hashtags,
          visualDirection: JSON.stringify(context.artDirection),
          imagePrompt: context.artDirection.imagePrompt,
          concept: context.artDirection.concept,
          overallScore: context.review?.overallScore,
          copyScore: context.review?.copyScore,
          compositionScore: context.review?.compositionScore,
          hierarchyScore: context.review?.hierarchyScore,
          contrastScore: context.review?.contrastScore,
          brandScore: context.review?.brandScore,
          strengths: context.review?.strengths || [],
          issues: context.review?.issues || [],
          recommendations: context.review?.recommendations || [],
          assets: {
            create: context.images.map((img: { url: string; storageKey: string; mimeType: string }) => ({
              url: img.url,
              storageKey: img.storageKey,
              mimeType: img.mimeType,
            })),
          },
        },
        include: { assets: true },
      });

      await this.completeExecutionStep(execution.id, 7, 'Finalização', 'Sistema', {
        tokensInput: 0,
        tokensOutput: 0,
        estimatedCost: 0,
      });

      // Atualiza Workflow e Campanha para COMPLETED
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'COMPLETED', completedAt: new Date(), currentStep: 7 },
      });

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'COMPLETED' },
      });

      console.log(`✅ Workflow da campanha ${campaignId} finalizado com sucesso!`);
      return { executionId: execution.id, creativeVersion, context };
    } catch (err: any) {
      console.error(`❌ Erro no workflow da campanha ${campaignId}:`, err);
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'FAILED', error: err.message },
      });
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  /**
   * Refinamento: Gera uma nova CreativeVersion (V2, V3, etc.) preservando as versões anteriores
   */
  async refineCreativeVersion(creativeVersionId: string, userPrompt: string) {
    const previousVersion = await prisma.creativeVersion.findUnique({
      where: { id: creativeVersionId },
      include: { creative: { include: { campaign: true } } },
    });

    if (!previousVersion) throw new Error('Versão anterior não encontrada');

    const nextVersionNumber = previousVersion.versionNumber + 1;

    // Registra a solicitação de refinamento
    await prisma.refinementRequest.create({
      data: {
        creativeVersionId,
        userPrompt,
      },
    });

    const provider = await providerRouter.getProviderForWorkspace('anthropic', previousVersion.creative.campaign.workspaceId);
    const prompt = `
O usuário solicitou um refinamento para a peça visual:
Versão Anterior: V${previousVersion.versionNumber}
Headline Atual: "${previousVersion.headline}"
CTA Atual: "${previousVersion.cta}"
Solicitação de Alteração: "${userPrompt}"

Gere a versão atualizada com a nova headline, CTA e novos ajustes.
`;

    const res = await provider.generateStructured(prompt, CopyOutputSchema, {
      temperature: 0.5,
    });
    const copyData = res.data as z.infer<typeof CopyOutputSchema>;

    // Reavalia de verdade com o Crítico em cima do novo copy, em vez de inventar uma melhora
    // fixa (+4/+5) sobre a nota anterior — a pontuação da nova versão reflete o que ela
    // realmente entregou, podendo inclusive piorar em alguma rubrica.
    const criticPrompt = `
Você é o Agente CRÍTICO de design e comunicação.
Avalie esta NOVA versão da peça (resultado de um pedido de refinamento) de 0 a 100 nas rubricas (Copy, Composição, Hierarquia, Contraste, Marca) e forneça pontos fortes, problemas e recomendações:
Headline: "${copyData.headline}"
Subtítulo: "${copyData.subheadline}"
Direção de arte: "${previousVersion.concept}"
Pedido de refinamento atendido: "${userPrompt}"
`;
    const criticRes = await provider.generateStructured(criticPrompt, ReviewOutputSchema, {
      temperature: 0.2,
    });
    const review = criticRes.data;

    // Gera nova versão sem sobrescrever V1
    const newVersion = await prisma.creativeVersion.create({
      data: {
        creativeId: previousVersion.creativeId,
        versionNumber: nextVersionNumber,
        headline: copyData.headline,
        subheadline: copyData.subheadline,
        cta: copyData.cta,
        caption: copyData.caption,
        hashtags: copyData.hashtags,
        visualDirection: previousVersion.visualDirection,
        imagePrompt: previousVersion.imagePrompt,
        concept: previousVersion.concept,
        overallScore: review.overallScore,
        copyScore: review.copyScore,
        compositionScore: review.compositionScore,
        hierarchyScore: review.hierarchyScore,
        contrastScore: review.contrastScore,
        brandScore: review.brandScore,
        strengths: review.strengths,
        issues: review.issues,
        recommendations: review.recommendations,
      },
    });

    return newVersion;
  }

  private async updateExecutionStep(executionId: string, stepNumber: number, name: string, status: 'RUNNING' | 'COMPLETED' | 'FAILED') {
    await prisma.workflowExecutionStep.upsert({
      where: { id: `${executionId}_step_${stepNumber}` },
      update: { status, startedAt: new Date() },
      create: {
        id: `${executionId}_step_${stepNumber}`,
        workflowExecutionId: executionId,
        stepNumber,
        name,
        status,
        startedAt: new Date(),
      },
    });
  }

  private async completeExecutionStep(executionId: string, stepNumber: number, name: string, model: string, res: any) {
    const dataOutput = res && typeof res === 'object' && 'data' in res ? (res as any).data : res;
    await prisma.workflowExecutionStep.update({
      where: { id: `${executionId}_step_${stepNumber}` },
      data: {
        status: 'COMPLETED',
        model,
        output: dataOutput ? (dataOutput as any) : res,
        tokensInput: res.tokensInput || 0,
        tokensOutput: res.tokensOutput || 0,
        estimatedCost: res.estimatedCost || 0,
        completedAt: new Date(),
      },
    });
  }
}

export const orchestratorService = new OrchestratorService();
