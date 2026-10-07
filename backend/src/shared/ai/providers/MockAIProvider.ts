import { z } from 'zod';
import { AIProvider, AIProviderResult, ImageGenerationOptions, ImageAnalysisOptions, TextGenerationOptions } from '../interfaces/AIProvider.js';

export class MockAIProvider implements AIProvider {
  name = 'MockAIProvider';

  async generateText(prompt: string, options?: TextGenerationOptions): Promise<AIProviderResult<string>> {
    console.log(`[MOCK AI] Generating text for prompt snippet: "${prompt.slice(0, 60)}..."`);
    await new Promise((res) => setTimeout(res, 800));

    // Agentes operacionais: nunca devolver uma "análise" inventada que pareça real.
    if (prompt.includes('AGENTE OPERACIONAL')) {
      const dataChars = (prompt.split('<dados_nao_confiaveis>')[1] || '').length;
      const text =
        '⚠️ ANÁLISE SIMULADA (AI_MOCK_MODE=true)\n' +
        'Nenhum modelo de IA foi chamado nesta execução — este texto é um marcador de posição.\n' +
        `A etapa recebeu ${dataChars} caracteres de dados coletados, que seriam interpretados pelo modelo configurado.\n` +
        'Para análise real: defina ANTHROPIC_API_KEY e AI_MOCK_MODE=false no backend.';
      return { data: text, tokensInput: 0, tokensOutput: 0, estimatedCost: 0, rawText: text };
    }

    return {
      data: 'Estratégia e copy simulada gerada com sucesso pelo Mock AI Provider em alta performance.',
      tokensInput: 450,
      tokensOutput: 320,
      estimatedCost: 0.002,
      rawText: 'Estratégia e copy simulada gerada com sucesso pelo Mock AI Provider em alta performance.',
    };
  }

  async generateStructured<T>(prompt: string, schema: z.ZodSchema<T>, options?: TextGenerationOptions): Promise<AIProviderResult<T>> {
    console.log(`[MOCK AI] Generating structured output for prompt snippet: "${prompt.slice(0, 60)}..."`);
    await new Promise((res) => setTimeout(res, 1000));

    let mockData: any = {};

    // Identifica o tipo de step pelo marcador de papel do agente (único por prompt),
    // evitando colisões com palavras genéricas que aparecem em mais de um prompt
    // (ex: "Estratégia:" também aparece como cabeçalho de seção no prompt do Copywriter).
    if (prompt.includes('ESTRATEGISTA') || prompt.includes('STRATEGIST')) {
      mockData = {
        audience: 'Donos e gestores de PMEs (5 a 50 funcionários) em centros urbanos.',
        painPoint: 'Queda constante de internet interrompe vendas, suporte operadora é lento.',
        uniqueAngle: 'Continuidade do negócio e custo da instabilidade, em vez de apenas velocidade.',
        proof: 'SLA de 99,9%, suporte técnico local 24/7 e banda simétrica dedicada.',
        funnelStage: 'Topo com dor operacional + Meio com prova de estabilidade.',
      };
    } else if (prompt.includes('COPYWRITER')) {
      mockData = {
        headline: 'Sua empresa não pode parar por falta de conexão.',
        subheadline: 'Tenha uma internet empresarial com link dedicado e suporte local 24/7.',
        cta: 'Fale com a Simplisoft',
        caption: 'Cada minuto offline é faturamento perdido. Reuniões caindo, vendas paradas e clientes sem resposta.\n\nA Simplisoft entrega link dedicado estável, banda simétrica e suporte presencial rápido. Proteja a operação da sua empresa hoje mesmo!\n\n👉 Clique no link da bio e solicite um teste.',
        hashtags: ['#internetempresarial', '#simplisoft', '#linkdedicado', '#pme', '#conectividade'],
      };
    } else if (prompt.includes('Solicitação de Alteração:')) {
      mockData = {
        headline: 'Sua empresa não pode esperar por uma conexão instável.',
        subheadline: 'Link dedicado, banda simétrica e suporte local 24/7 — refinado a partir do seu pedido.',
        cta: 'Fale com a Simplisoft agora',
        caption: 'Versão refinada com base no seu direcionamento: mais urgência na headline e CTA em destaque.\n\nA Simplisoft entrega estabilidade real para sua operação continuar rodando.\n\n👉 Clique no link da bio e solicite um teste.',
        hashtags: ['#internetempresarial', '#simplisoft', '#linkdedicado', '#pme', '#conectividade'],
      };
    } else if (prompt.includes('DIRETOR DE ARTE') || prompt.includes('ART_DIRECTOR')) {
      mockData = {
        concept: 'Continuidade operacional retratada em ambiente real de trabalho corporativo.',
        composition: 'Regra dos terços, sujeito focado à direita, respiro superior-esquerdo reservado para a headline.',
        lighting: 'Luz natural lateral difusa, sombras suaves e sem reflexos duros.',
        framing: 'Plano médio, 35mm, profundidade de campo sutil.',
        typography: 'Sans-serif geométrica 600 na headline, fonte mono para dados técnicos.',
        elements: 'Rack de servidor discreto ao fundo levemente desfocado, notebook na mesa, ambiente clean.',
        palette: ['#0F3B63', '#1E6FA8', '#F2F4F7', '#101210', '#C7873F'],
        imagePrompt: 'corporate office interior, small business team, natural diffuse side light, meeting table with laptop, blurred server rack in background, deep petrol blue palette, documentary photography, 35mm, upper-left negative space for headline, subtle grain, 1:1',
      };
    } else if (prompt.includes('CRÍTICO') || prompt.includes('CRITIC')) {
      mockData = {
        overallScore: 86,
        copyScore: 90,
        compositionScore: 84,
        hierarchyScore: 82,
        contrastScore: 85,
        brandScore: 89,
        strengths: [
          'Headline direta com alta tensão de dor e leitura imediata.',
          'Paleta perfeitamente alinhada com o Brand Kit oficial.',
          'Fotografia documental crível sem estética genérica de banco de imagem.',
        ],
        issues: [
          'O botão de CTA poderia ter um contraste ligeiramente maior no rodapé.',
          'Subtítulo está concorrendo visualmente com o peso da headline.',
        ],
        recommendations: [
          'Aumentar a área de clique e contraste do CTA em 15%.',
          'Ajustar o peso do subtítulo para 60% do tamanho da headline.',
        ],
      };
    } else {
      mockData = {
        result: 'Execução mock genérica para validação de fluxo.',
      };
    }

    return {
      data: mockData as T,
      tokensInput: 680,
      tokensOutput: 520,
      estimatedCost: 0.004,
    };
  }

  async generateImage(options: ImageGenerationOptions): Promise<AIProviderResult<string[]>> {
    console.log(`[MOCK AI] Generating ${options.count || 4} mock images for prompt: "${options.prompt.slice(0, 60)}..."`);
    await new Promise((res) => setTimeout(res, 1200));

    // URLs simuladas de variação em formato Canvas SVG/Gradient compatíveis com o frontend
    const mockImages = [
      'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1080&q=80',
      'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1080&q=80',
      'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1080&q=80',
      'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1080&q=80',
    ];

    return {
      data: mockImages.slice(0, options.count || 4),
      tokensInput: 150,
      tokensOutput: 0,
      estimatedCost: 0.04,
    };
  }

  async analyzeImage(options: ImageAnalysisOptions): Promise<AIProviderResult<string>> {
    console.log(`[MOCK AI] Analyzing image ${options.imageUrl}`);
    await new Promise((res) => setTimeout(res, 800));

    return {
      data: 'Análise mock: A imagem possui ótima iluminação, alinhamento aos terços e bom espaço de respiro.',
      tokensInput: 800,
      tokensOutput: 200,
      estimatedCost: 0.005,
    };
  }
}
