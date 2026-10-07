import nodemailer from 'nodemailer';
import { z } from 'zod';
import { InterventionError, RecoverableError } from '../errors.js';
import { assertAllowedUrl } from '../network.js';
import { ToolDefinition } from '../types.js';

// ── Telegram ─────────────────────────────────────────────

const TelegramInput = z.object({
  credential: z.string().min(1),
  text: z.string().min(1),
  /** sobrescreve o chat padrão da credencial */
  chatId: z.string().optional(),
});
type TelegramInput = z.infer<typeof TelegramInput>;

export async function sendTelegram(data: Record<string, any>, text: string, chatId: string | undefined, signal: AbortSignal) {
  const token = data.botToken;
  const target = chatId || data.chatId;
  if (!token || !target) throw new InterventionError('Credencial Telegram incompleta: informe botToken e chatId.');

  // Limite da API: 4096 caracteres por mensagem.
  const chunks = text.match(/[\s\S]{1,4000}/g) || [''];
  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text: chunk, disable_web_page_preview: true }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (res.status === 401 || res.status === 404) throw new InterventionError('Token do bot Telegram inválido.');
    if (res.status === 400 || res.status === 403) {
      const body = await res.json().catch(() => ({}));
      throw new InterventionError(`Telegram recusou a mensagem: ${(body as any).description || res.status}`);
    }
    if (!res.ok) throw new RecoverableError(`Telegram respondeu ${res.status}.`);
  }
  return chunks.length;
}

export const telegramSendTool: ToolDefinition<TelegramInput> = {
  name: 'telegram.send',
  label: 'Enviar Telegram',
  description: 'Entrega o resultado em um chat/grupo do Telegram via bot configurado em Credenciais.',
  category: 'entrega',
  inputSchema: TelegramInput,
  credentialTypes: ['telegram_bot'],
  example: { credential: 'Bot Diretoria', text: '📊 RESUMO COMERCIAL · {{now.date}}\n\n{{steps.analise.output.text}}' },
  permission: () => 'notify',
  async run(input, ctx) {
    const parts = await sendTelegram(ctx.credential!.data, input.text, input.chatId, ctx.signal);
    return { output: { delivered: true, channel: 'telegram', parts }, summary: `Telegram enviado (${input.text.length} caracteres)` };
  },
};

// ── E-mail (SMTP) ────────────────────────────────────────

const EmailInput = z.object({
  credential: z.string().min(1),
  to: z.union([z.string(), z.array(z.string())]),
  subject: z.string().min(1),
  text: z.string().min(1),
});
type EmailInput = z.infer<typeof EmailInput>;

export async function sendEmail(
  data: Record<string, any>,
  to: string[],
  subject: string,
  text: string,
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>,
) {
  if (!data.host || !data.from) throw new InterventionError('Credencial SMTP incompleta: informe host e from.');
  const transporter = nodemailer.createTransport({
    host: data.host,
    port: Number(data.port) || 587,
    secure: data.secure === true || data.secure === 'true' || Number(data.port) === 465,
    auth: data.user ? { user: data.user, pass: data.pass } : undefined,
    connectionTimeout: 15_000,
  });
  try {
    await transporter.sendMail({ from: data.from, to, subject, text, ...(attachments?.length ? { attachments } : {}) });
  } catch (err: any) {
    if (err?.responseCode === 535 || err?.code === 'EAUTH') throw new InterventionError('SMTP recusou a autenticação — verifique usuário/senha.');
    if (err?.code === 'EENVELOPE') throw new InterventionError(`Destinatário inválido: ${err.message}`);
    throw new RecoverableError(`Falha ao enviar e-mail: ${err?.message || err}`);
  }
}

export const emailSendTool: ToolDefinition<EmailInput> = {
  name: 'email.send',
  label: 'Enviar e-mail',
  description: 'Envia o resultado por e-mail usando o servidor SMTP cadastrado em Credenciais.',
  category: 'entrega',
  inputSchema: EmailInput,
  credentialTypes: ['smtp'],
  example: { credential: 'SMTP Simplisoft', to: ['diretoria@empresa.com.br'], subject: 'Resumo comercial {{now.date}}', text: '{{steps.analise.output.text}}' },
  permission: () => 'notify',
  async run(input, ctx) {
    const to = Array.isArray(input.to) ? input.to : input.to.split(',').map((s) => s.trim()).filter(Boolean);
    await sendEmail(ctx.credential!.data, to, input.subject, input.text);
    return { output: { delivered: true, channel: 'email', to }, summary: `E-mail enviado para ${to.length} destinatário(s)` };
  },
};

// ── Webhook ──────────────────────────────────────────────

const WebhookInput = z.object({
  credential: z.string().optional(),
  url: z.string().optional(),
  payload: z.any(),
});
type WebhookInput = z.infer<typeof WebhookInput>;

export const webhookSendTool: ToolDefinition<WebhookInput> = {
  name: 'webhook.send',
  label: 'Enviar webhook',
  description: 'Entrega o resultado em JSON para um endpoint do cliente (URL na allowlist ou cadastrada em Credenciais).',
  category: 'entrega',
  inputSchema: WebhookInput,
  credentialTypes: ['webhook'],
  example: { credential: 'Webhook BI', payload: { agente: '{{agent.name}}', data: '{{now.isoDate}}', indicadores: '{{steps.indicadores.output.totals}}' } },
  permission: () => 'notify',
  async run(input, ctx) {
    const target = ctx.credential?.data?.url || input.url;
    if (!target) throw new InterventionError('Informe a URL do webhook ou uma credencial do tipo webhook.');
    // URL cadastrada pelo administrador em Credenciais dispensa a allowlist; URL livre no playbook não.
    const url = await assertAllowedUrl(target, ctx.credential?.data?.url ? null : ctx.agent.allowedDomains);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ctx.credential?.data?.secret) headers['X-Webhook-Secret'] = ctx.credential.data.secret;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.payload ?? {}),
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]),
      redirect: 'error',
    });
    if (res.status === 429 || res.status >= 500) throw new RecoverableError(`Webhook respondeu ${res.status}.`);
    if (!res.ok) throw new InterventionError(`Webhook recusou a entrega (${res.status}).`);
    return { output: { delivered: true, channel: 'webhook', status: res.status }, summary: `Webhook ${url.hostname} → ${res.status}` };
  },
};
