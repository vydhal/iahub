import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ScheduledPost } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { sendEmail } from '../../agent-ops/tools/delivery.js';
import { decryptJson } from '../../shared/security/crypto.js';
import { MEDIA_DIR } from '../media/media.routes.js';

export const CHANNELS = ['telegram', 'email', 'webhook'] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_INFO = [
  { key: 'telegram', label: 'Telegram', credentialType: 'telegram_bot', help: 'Publica a legenda e as imagens no chat/grupo configurado no bot.' },
  { key: 'email', label: 'E-mail', credentialType: 'smtp', help: 'Envia a legenda e as imagens em anexo para os destinatários.' },
  { key: 'webhook', label: 'Webhook', credentialType: 'webhook', help: 'Entrega o conteúdo em JSON para a sua automação publicar (n8n, Make, Zapier…).' },
];

/** Link temporário e assinado para o destinatário do webhook baixar a imagem sem login. */
export function signMediaUrl(assetId: string, days = 7) {
  const exp = Date.now() + days * 86_400_000;
  const sig = createHmac('sha256', env.JWT_SECRET).update(`${assetId}.${exp}`).digest('hex').slice(0, 32);
  return `${env.PUBLIC_API_URL}/api/media/${assetId}/file?exp=${exp}&sig=${sig}`;
}

export function verifyMediaSignature(assetId: string, exp: string, sig: string) {
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = createHmac('sha256', env.JWT_SECRET).update(`${assetId}.${exp}`).digest('hex').slice(0, 32);
  return expected === sig;
}

async function loadAssets(workspaceId: string, assetIds: string[]) {
  if (!assetIds.length) return [];
  const assets = await prisma.mediaAsset.findMany({ where: { workspaceId, id: { in: assetIds } } });
  // mantém a ordem escolhida pelo usuário
  const byId = new Map(assets.map((a) => [a.id, a]));
  return assetIds.map((id) => byId.get(id)).filter(Boolean) as typeof assets;
}

async function credentialData(workspaceId: string, name?: string | null) {
  if (!name) return null;
  const cred = await prisma.credential.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
  if (!cred || cred.status !== 'active') return null;
  return { type: cred.type, data: decryptJson<Record<string, any>>(cred.encryptedData) };
}

async function telegramUpload(botToken: string, chatId: string, caption: string, files: Array<{ name: string; buffer: Buffer; mime: string }>) {
  const api = `https://api.telegram.org/bot${botToken}`;
  const call = async (method: string, form: FormData) => {
    const res = await fetch(`${api}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(`Telegram recusou (${method}): ${body.description || res.status}`);
    return body;
  };

  if (!files.length) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('text', caption);
    return call('sendMessage', form);
  }
  if (files.length === 1) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption.slice(0, 1024));
    form.append('photo', new Blob([new Uint8Array(files[0].buffer)], { type: files[0].mime }), files[0].name);
    return call('sendPhoto', form);
  }
  // carrossel: álbum de até 10 imagens, legenda na primeira
  const form = new FormData();
  form.append('chat_id', chatId);
  const media = files.slice(0, 10).map((f, i) => ({
    type: 'photo',
    media: `attach://file${i}`,
    ...(i === 0 ? { caption: caption.slice(0, 1024) } : {}),
  }));
  form.append('media', JSON.stringify(media));
  files.slice(0, 10).forEach((f, i) => form.append(`file${i}`, new Blob([new Uint8Array(f.buffer)], { type: f.mime }), f.name));
  return call('sendMediaGroup', form);
}

/**
 * Entrega o post no canal escolhido. Não publica em rede social por conta própria:
 * entrega para quem publica (pessoa no Telegram/e-mail) ou para a automação do cliente (webhook).
 */
export async function publishPost(post: ScheduledPost): Promise<{ result: Record<string, unknown> }> {
  const assets = await loadAssets(post.workspaceId, post.assetIds);
  const cred = await credentialData(post.workspaceId, post.credentialName);

  if (post.channel === 'telegram') {
    if (!cred || cred.type !== 'telegram_bot') throw new Error(`Credencial Telegram "${post.credentialName}" não encontrada ou inativa.`);
    const files = await Promise.all(
      assets.slice(0, 10).map(async (a) => ({ name: a.name, mime: a.mimeType, buffer: await readFile(path.join(MEDIA_DIR, a.storageKey)) })),
    );
    const body = await telegramUpload(cred.data.botToken, String(cred.data.chatId), `${post.title}\n\n${post.caption}`, files);
    return { result: { channel: 'telegram', messageId: body?.result?.message_id ?? null, imagens: files.length } };
  }

  if (post.channel === 'email') {
    if (!cred || cred.type !== 'smtp') throw new Error(`Credencial SMTP "${post.credentialName}" não encontrada ou inativa.`);
    if (!post.recipients.length) throw new Error('Informe ao menos um destinatário de e-mail.');
    const attachments = await Promise.all(
      assets.map(async (a) => ({ filename: a.name, content: await readFile(path.join(MEDIA_DIR, a.storageKey)), contentType: a.mimeType })),
    );
    await sendEmail(cred.data, post.recipients, post.title, post.caption, attachments);
    return { result: { channel: 'email', destinatarios: post.recipients.length, anexos: attachments.length } };
  }

  if (post.channel === 'webhook') {
    const url = cred?.data?.url;
    if (!url) throw new Error(`Credencial de webhook "${post.credentialName}" não encontrada ou sem URL.`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cred?.data?.secret ? { 'X-Webhook-Secret': cred.data.secret } : {}) },
      body: JSON.stringify({
        evento: 'post.agendado',
        id: post.id,
        titulo: post.title,
        legenda: post.caption,
        agendadoPara: post.scheduledFor,
        imagens: assets.map((a) => ({ id: a.id, nome: a.name, url: signMediaUrl(a.id) })),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Webhook respondeu ${res.status}.`);
    return { result: { channel: 'webhook', status: res.status, imagens: assets.length } };
  }

  throw new Error(`Canal desconhecido: ${post.channel}`);
}
