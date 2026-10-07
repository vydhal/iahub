import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { decryptJson, encryptJson } from '../../shared/security/crypto.js';
import { InterventionError, PolicyError, RecoverableError } from '../errors.js';
import { assertAllowedUrl, hostAllowed } from '../network.js';
import { ToolDefinition, ToolRunContext } from '../types.js';

// RPA web — camada de compatibilidade para sistemas sem API (API > MCP > RPA).
// Interação por seletor/papel de acessibilidade, nunca por coordenada de tela.

const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string() }),
  z.object({ type: z.literal('click'), selector: z.string() }),
  z.object({
    type: z.literal('fill'),
    selector: z.string(),
    value: z.string().optional(),
    /** preenche com um campo da credencial (ex: "password") — o valor nunca aparece em log */
    credentialField: z.string().optional(),
  }),
  z.object({ type: z.literal('select'), selector: z.string(), value: z.string() }),
  z.object({ type: z.literal('wait'), selector: z.string().optional(), ms: z.number().int().max(30_000).optional() }),
  z.object({ type: z.literal('extractText'), selector: z.string(), as: z.string() }),
  z.object({ type: z.literal('extractTable'), selector: z.string(), as: z.string() }),
  z.object({ type: z.literal('snapshot'), as: z.string().default('snapshot') }),
  z.object({ type: z.literal('screenshot'), name: z.string().default('tela') }),
]);

const Input = z.object({
  startUrl: z.string(),
  actions: z.array(Action).max(40),
  credential: z.string().optional(),
  /** isolated = contexto novo a cada execução; persistent = reaproveita cookies/sessão deste agente */
  session: z.enum(['isolated', 'persistent']).default('isolated'),
  /** declare true quando a automação grava/altera dados no sistema (exige política de escrita) */
  mutates: z.boolean().default(false),
  timeoutSec: z.number().int().min(5).max(180).default(60),
});
type BrowserInput = z.infer<typeof Input>;

// Botões cujo clique costuma ser destrutivo/irreversível — bloqueados se a etapa não declarar mutates.
const DESTRUCTIVE_RE = /excluir|deletar|apagar|remover|delete|remove|cancelar pedido|estornar|pagar|confirmar pagamento|transferir|publicar|enviar proposta/i;
const STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'executions');

async function loadPlaywright(): Promise<any> {
  try {
    // import dinâmico: o runtime de browser é opcional e só é exigido por agentes RPA
    const mod = await import('playwright' as string);
    return mod.chromium ? mod : mod.default;
  } catch {
    throw new InterventionError(
      'Runtime de navegador indisponível: instale o Playwright no backend (npm i playwright && npx playwright install --with-deps chromium) ou use a imagem com browser.',
    );
  }
}

async function sessionCredentialName(agentId: string) {
  return `browser-session:${agentId}`;
}

export const browserTool: ToolDefinition<BrowserInput> = {
  name: 'browser.playwright',
  label: 'Navegador (RPA)',
  description: 'Automação web com Playwright para sistemas sem API: navegar, preencher, clicar, extrair textos/tabelas e capturar tela. Restrito aos domínios autorizados do agente.',
  category: 'rpa',
  inputSchema: Input,
  credentialTypes: ['login'],
  example: {
    startUrl: 'https://crm.empresa.com.br/login',
    credential: 'Login CRM',
    session: 'persistent',
    actions: [
      { type: 'fill', selector: '#email', credentialField: 'username' },
      { type: 'fill', selector: '#senha', credentialField: 'password' },
      { type: 'click', selector: 'button[type=submit]' },
      { type: 'wait', selector: 'text=Painel' },
      { type: 'navigate', url: 'https://crm.empresa.com.br/relatorios/vendas?periodo=hoje' },
      { type: 'extractTable', selector: 'table#vendas', as: 'vendas' },
    ],
  },
  permission: (input) => (input.mutates ? 'write' : 'read'),

  async run(input, ctx: ToolRunContext) {
    await assertAllowedUrl(input.startUrl, ctx.agent.allowedDomains);
    const pw = await loadPlaywright();
    const started = Date.now();
    const browser = await pw.chromium.launch({ headless: true });
    const extracted: Record<string, any> = {};
    const screenshots: string[] = [];

    // Sessão persistente: storageState criptografado como credencial interna do agente.
    const sessionName = await sessionCredentialName(ctx.agent.id);
    let storageState: any;
    if (input.session === 'persistent') {
      const saved = await prisma.credential.findUnique({ where: { workspaceId_name: { workspaceId: ctx.workspaceId, name: sessionName } } });
      if (saved) storageState = decryptJson(saved.encryptedData);
    }

    try {
      const context = await browser.newContext({ storageState, acceptDownloads: false });
      context.setDefaultTimeout(input.timeoutSec * 1000);
      // Bloqueia navegação de documentos para fora da allowlist (inclusive redirects e links injetados).
      await context.route('**/*', (route: any) => {
        const req = route.request();
        if (req.resourceType() === 'document' && req.isNavigationRequest()) {
          const host = new URL(req.url()).hostname;
          if (!hostAllowed(host, ctx.agent.allowedDomains)) return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(input.startUrl, { waitUntil: 'domcontentloaded' });

      for (const action of input.actions) {
        if (ctx.signal.aborted) throw new RecoverableError('Execução interrompida por tempo limite.');
        if (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha').count()) {
          throw new InterventionError(`CAPTCHA detectado em ${new URL(page.url()).hostname} — é necessária intervenção humana.`);
        }

        switch (action.type) {
          case 'navigate':
            await assertAllowedUrl(action.url, ctx.agent.allowedDomains);
            await page.goto(action.url, { waitUntil: 'domcontentloaded' });
            await ctx.log(`Navegando para ${new URL(action.url).hostname}${new URL(action.url).pathname}`);
            break;
          case 'click': {
            const target = page.locator(action.selector).first();
            const label = ((await target.textContent().catch(() => '')) || '') + ' ' + ((await target.getAttribute('value').catch(() => '')) || '');
            if (!input.mutates && DESTRUCTIVE_RE.test(label)) {
              throw new PolicyError(`Clique bloqueado em "${label.trim()}": ação potencialmente destrutiva. Marque a etapa como "mutates" e exija aprovação.`);
            }
            await target.click();
            await ctx.log(`Clique em ${action.selector}`);
            break;
          }
          case 'fill': {
            let value = action.value ?? '';
            if (action.credentialField) {
              if (!ctx.credential) throw new InterventionError('Etapa usa campo de credencial, mas nenhuma credencial foi vinculada.');
              value = String(ctx.credential.data[action.credentialField] ?? '');
            }
            await page.locator(action.selector).first().fill(value);
            await ctx.log(`Preenchido ${action.selector}${action.credentialField ? ' (credencial)' : ''}`);
            break;
          }
          case 'select':
            await page.locator(action.selector).first().selectOption(action.value);
            break;
          case 'wait':
            if (action.selector) await page.locator(action.selector).first().waitFor();
            else await page.waitForTimeout(action.ms ?? 1000);
            break;
          case 'extractText':
            extracted[action.as] = (await page.locator(action.selector).allInnerTexts()).map((t: string) => t.trim());
            break;
          case 'extractTable':
            extracted[action.as] = await page.locator(action.selector).first().evaluate((table: any) => {
              const rows = [...table.querySelectorAll('tr')] as any[];
              const header = rows.shift();
              const keys = header ? [...header.querySelectorAll('th,td')].map((c: any) => c.innerText.trim()) : [];
              return rows.map((r) => Object.fromEntries([...r.querySelectorAll('td')].map((c: any, i: number) => [keys[i] || `col${i}`, c.innerText.trim()])));
            });
            await ctx.log(`Tabela extraída: ${action.selector} (${extracted[action.as].length} linhas)`);
            break;
          case 'snapshot':
            // snapshot de acessibilidade = representação estruturada, preferida a screenshot para a IA
            extracted[action.as] = (await page.locator('body').ariaSnapshot()).slice(0, 30_000);
            break;
          case 'screenshot': {
            const dir = path.join(STORAGE_DIR, ctx.executionId);
            await mkdir(dir, { recursive: true });
            const file = `${Date.now()}-${action.name.replace(/[^a-z0-9_-]/gi, '_')}.png`;
            await writeFile(path.join(dir, file), await page.screenshot({ fullPage: true }));
            screenshots.push(file);
            break;
          }
        }
      }

      if (input.session === 'persistent') {
        const state = await context.storageState();
        await prisma.credential.upsert({
          where: { workspaceId_name: { workspaceId: ctx.workspaceId, name: sessionName } },
          update: { encryptedData: encryptJson(state) },
          create: { workspaceId: ctx.workspaceId, name: sessionName, type: 'browser_session', encryptedData: encryptJson(state), metadata: { agentId: ctx.agent.id } },
        });
      }

      return {
        output: { url: page.url(), data: extracted, screenshots },
        summary: `${input.actions.length} ações em ${new URL(page.url()).hostname}`,
        usage: { browserMs: Date.now() - started },
      };
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        throw new RecoverableError(`Elemento não encontrado a tempo (${err.message.split('\n')[0]}). Se persistir, a estrutura da página pode ter mudado.`);
      }
      throw err;
    } finally {
      await browser.close().catch(() => {});
    }
  },
};
