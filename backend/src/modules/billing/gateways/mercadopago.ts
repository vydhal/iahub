import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Invoice } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { decryptJson } from '../../../shared/security/crypto.js';

const API = 'https://api.mercadopago.com';

export interface MercadoPagoConfig {
  accessToken: string;
  webhookSecret?: string;
}

/** A credencial do gateway vive no mesmo cofre criptografado das demais (tipo `mercadopago`). */
export async function mercadoPagoConfig(workspaceId: string): Promise<MercadoPagoConfig | null> {
  const cred = await prisma.credential.findFirst({ where: { workspaceId, type: 'mercadopago', status: 'active' } });
  if (!cred) return null;
  const data = decryptJson<Record<string, string>>(cred.encryptedData);
  return data.accessToken ? { accessToken: data.accessToken, webhookSecret: data.webhookSecret } : null;
}

async function mpFetch(cfg: MercadoPagoConfig, path: string, init: RequestInit & { idempotencyKey?: string } = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
      ...(init.idempotencyKey ? { 'X-Idempotency-Key': init.idempotencyKey } : {}),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Mercado Pago respondeu ${res.status}: ${data?.message || data?.error || text.slice(0, 200)}`);
  }
  return data;
}

/**
 * Cria a order do Checkout Pro e devolve a URL de pagamento.
 * Doc: POST /v1/orders (type "online", processing_mode "manual") → checkout_url.
 */
export async function createCheckout(cfg: MercadoPagoConfig, invoice: Invoice, payerEmail: string, description: string) {
  const amount = (invoice.totalCents / 100).toFixed(2);
  const order = await mpFetch(cfg, '/v1/orders', {
    method: 'POST',
    idempotencyKey: invoice.id,
    body: JSON.stringify({
      type: 'online',
      processing_mode: 'manual',
      total_amount: amount,
      external_reference: invoice.number,
      description,
      payer: { email: payerEmail },
      items: [{ title: description, unit_price: amount, quantity: 1, unit_measure: 'unit', total_amount: amount }],
    }),
  });
  return { externalId: String(order.id), checkoutUrl: order.checkout_url as string, raw: order };
}

export async function fetchOrder(cfg: MercadoPagoConfig, orderId: string) {
  const order = await mpFetch(cfg, `/v1/orders/${orderId}`);
  const paidAmount = Number(order.total_paid_amount || 0);
  const total = Number(order.total_amount || 0);
  return {
    status: String(order.status || ''),
    paid: paidAmount > 0 && paidAmount >= total,
    paymentMethod: order.transactions?.payments?.[0]?.payment_method?.id || null,
    raw: order,
  };
}

/**
 * Valida a assinatura HMAC do webhook (header x-signature: ts=...,v1=...).
 * Manifest: id:<data.id minúsculo>;request-id:<x-request-id>;ts:<ts>;
 */
export function verifySignature(opts: { signature?: string; requestId?: string; dataId?: string; secret?: string }): boolean {
  if (!opts.secret) return false;
  const parts = Object.fromEntries(
    (opts.signature || '')
      .split(',')
      .map((p) => p.split('=').map((x) => x.trim()))
      .filter((p) => p.length === 2),
  ) as Record<string, string>;
  if (!parts.ts || !parts.v1) return false;

  const manifest =
    (opts.dataId ? `id:${opts.dataId.toLowerCase()};` : '') +
    (opts.requestId ? `request-id:${opts.requestId};` : '') +
    `ts:${parts.ts};`;

  const expected = createHmac('sha256', opts.secret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts.v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
