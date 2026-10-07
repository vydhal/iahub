import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/prisma.js';
import { createAndEnqueue } from '../../agent-ops/queue.js';
import { markInvoicePaid } from '../billing/billing.engine.js';
import { fetchOrder, mercadoPagoConfig, verifySignature } from '../billing/gateways/mercadopago.js';
import { audit } from '../../shared/audit/audit.js';

/**
 * Gatilho por evento externo: POST /api/hooks/agents/:token
 * O token é o segredo (rotacionável na aba Agendamento). O corpo vira `input` da execução
 * e é tratado como dado não confiável pelo playbook.
 */
export async function hookRoutes(fastify: FastifyInstance) {
  fastify.post('/agents/:token', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const agent = await prisma.agent.findUnique({ where: { webhookToken: token } });
    if (!agent || agent.kind !== 'OPERATIONAL' || agent.scheduleType !== 'webhook') {
      return reply.status(404).send({ message: 'Gatilho não encontrado.' });
    }
    if (agent.status !== 'ACTIVE') return reply.status(409).send({ message: 'Agente não está ativo.' });

    const execution = await createAndEnqueue(agent, 'webhook', { payload: request.body ?? null });
    await audit(agent.workspaceId!, null, 'agent.webhook_trigger', 'agent', agent.id, { executionId: execution.id });
    return reply.status(202).send({ executionId: execution.id });
  });

  /**
   * Notificação de pagamento do Mercado Pago.
   * A assinatura HMAC é conferida e, mesmo assim, o pagamento só é confirmado consultando
   * a order na API — o corpo da notificação nunca é tratado como verdade.
   */
  fastify.post('/payments/mercadopago/:workspaceId', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = request.query as Record<string, string>;
    const body = (request.body || {}) as any;
    const dataId = query['data.id'] || body?.data?.id || body?.id;

    const cfg = await mercadoPagoConfig(workspaceId);
    if (!cfg) return reply.status(404).send({ message: 'Gateway não configurado para este workspace.' });

    const ok = verifySignature({
      signature: request.headers['x-signature'] as string,
      requestId: request.headers['x-request-id'] as string,
      dataId: dataId ? String(dataId) : undefined,
      secret: cfg.webhookSecret,
    });
    if (!ok) {
      await prisma.paymentEvent.create({
        data: { gateway: 'mercadopago', externalId: dataId ? String(dataId) : null, type: 'signature_rejected', payload: { query, type: body?.type ?? null } },
      });
      return reply.status(401).send({ message: 'Assinatura inválida.' });
    }

    const invoice = dataId ? await prisma.invoice.findFirst({ where: { workspaceId, externalId: String(dataId) } }) : null;
    await prisma.paymentEvent.create({
      data: { invoiceId: invoice?.id ?? null, gateway: 'mercadopago', externalId: dataId ? String(dataId) : null, type: String(body?.type || body?.action || 'notification'), payload: body },
    });
    if (!invoice) return reply.status(200).send({ received: true, matched: false });

    try {
      const status = await fetchOrder(cfg, invoice.externalId!);
      if (status.paid && invoice.status !== 'paid') {
        await markInvoicePaid(invoice, { paymentMethod: status.paymentMethod || 'mercadopago', gateway: 'mercadopago' });
        await audit(workspaceId, null, 'billing.invoice_paid', 'invoice', invoice.id, { number: invoice.number, via: 'webhook' });
      }
    } catch (err: any) {
      request.log.error({ err }, 'Falha ao confirmar pagamento no gateway');
    }
    return reply.status(200).send({ received: true, matched: true });
  });
}
