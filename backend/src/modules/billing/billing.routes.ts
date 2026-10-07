import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { audit } from '../../shared/audit/audit.js';
import { tenantOf } from '../../shared/tenancy/tenant.js';
import { closeCycle, cycleUsage, ensureSubscription, markInvoicePaid, refreshOverdue } from './billing.engine.js';
import { createCheckout, fetchOrder, mercadoPagoConfig } from './gateways/mercadopago.js';

export async function billingRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: fastify.moduleGuard('cobranca') };

  fastify.get('/overview', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    await refreshOverdue(workspaceId);
    const sub = await ensureSubscription(workspaceId);
    const [usage, plans, invoices, gateway] = await Promise.all([
      cycleUsage(workspaceId, sub),
      prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.invoice.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 24 }),
      mercadoPagoConfig(workspaceId),
    ]);

    return reply.send({
      subscription: { ...sub, plan: sub.plan },
      usage,
      plans,
      invoices,
      gateway: {
        connected: !!gateway,
        provider: 'mercadopago',
        webhookUrl: `${env.PUBLIC_API_URL}/api/hooks/payments/mercadopago/${workspaceId}`,
      },
      openTotalCents: invoices.filter((i) => i.status === 'open' || i.status === 'overdue').reduce((n, i) => n + i.totalCents, 0),
    });
  });

  fastify.post('/subscribe', guard, async (request, reply) => {
    const { workspaceId, userId, role } = tenantOf(request);
    if (role === 'MEMBER') return reply.status(403).send({ message: 'Apenas administradores alteram o plano.' });
    const { planCode } = z.object({ planCode: z.string() }).parse(request.body);
    const plan = await prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.active) return reply.status(404).send({ message: 'Plano não encontrado' });

    const sub = await ensureSubscription(workspaceId);
    const updated = await prisma.subscription.update({ where: { workspaceId }, data: { planId: plan.id, status: 'active' }, include: { plan: true } });
    // O painel mostra o plano do workspace em vários pontos: mantém os dois lados coerentes.
    await prisma.workspace.update({ where: { id: workspaceId }, data: { plan: plan.name, creditsTotal: plan.creditsIncluded } });
    await audit(workspaceId, userId, 'billing.plan_change', 'subscription', updated.id, { de: sub.plan.code, para: plan.code });
    return reply.send(updated);
  });

  fastify.post('/close-cycle', guard, async (request, reply) => {
    const { workspaceId, userId, role } = tenantOf(request);
    if (role === 'MEMBER') return reply.status(403).send({ message: 'Apenas administradores fecham o ciclo.' });
    const { force } = z.object({ force: z.boolean().default(false) }).parse(request.body || {});
    try {
      const invoice = await closeCycle(workspaceId, { force });
      await audit(workspaceId, userId, 'billing.close_cycle', 'invoice', invoice.id, { number: invoice.number, totalCents: invoice.totalCents, force });
      return reply.status(201).send(invoice);
    } catch (err: any) {
      return reply.status(409).send({ message: err.message });
    }
  });

  // Gera o link de pagamento no gateway (Checkout Pro do Mercado Pago).
  fastify.post('/invoices/:id/checkout', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId } });
    if (!invoice) return reply.status(404).send({ message: 'Fatura não encontrada' });
    if (invoice.status === 'paid') return reply.status(409).send({ message: 'Fatura já paga.' });

    const cfg = await mercadoPagoConfig(workspaceId);
    if (!cfg) {
      return reply.status(422).send({
        message: 'Nenhum gateway conectado. Cadastre uma credencial do tipo "mercadopago" (Access Token) em Credenciais para gerar o link de pagamento.',
      });
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    try {
      const { externalId, checkoutUrl, raw } = await createCheckout(cfg, invoice, user?.email || 'comprador@exemplo.com', `Fatura ${invoice.number} · Simplisoft`);
      const updated = await prisma.invoice.update({ where: { id }, data: { gateway: 'mercadopago', externalId, checkoutUrl } });
      await prisma.paymentEvent.create({ data: { invoiceId: id, gateway: 'mercadopago', externalId, type: 'checkout_created', status: raw?.status, payload: raw } });
      await audit(workspaceId, userId, 'billing.checkout', 'invoice', id, { number: invoice.number, externalId });
      return reply.send(updated);
    } catch (err: any) {
      return reply.status(502).send({ message: err.message });
    }
  });

  // Consulta o gateway e atualiza o status (não depende do webhook chegar).
  fastify.post('/invoices/:id/refresh', guard, async (request, reply) => {
    const { workspaceId, userId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId } });
    if (!invoice) return reply.status(404).send({ message: 'Fatura não encontrada' });
    if (!invoice.externalId) return reply.status(409).send({ message: 'Fatura sem cobrança criada no gateway.' });

    const cfg = await mercadoPagoConfig(workspaceId);
    if (!cfg) return reply.status(422).send({ message: 'Gateway não conectado.' });
    try {
      const status = await fetchOrder(cfg, invoice.externalId);
      await prisma.paymentEvent.create({ data: { invoiceId: id, gateway: 'mercadopago', externalId: invoice.externalId, type: 'status_check', status: status.status, payload: status.raw } });
      if (status.paid && invoice.status !== 'paid') {
        const paid = await markInvoicePaid(invoice, { paymentMethod: status.paymentMethod || 'mercadopago', gateway: 'mercadopago' });
        await audit(workspaceId, userId, 'billing.invoice_paid', 'invoice', id, { number: invoice.number, via: 'consulta' });
        return reply.send(paid);
      }
      return reply.send({ ...invoice, gatewayStatus: status.status });
    } catch (err: any) {
      return reply.status(502).send({ message: err.message });
    }
  });

  // Pagamento fora do sistema (PIX/boleto/transferência): registrado com responsável e observação.
  fastify.post('/invoices/:id/manual-payment', guard, async (request, reply) => {
    const { workspaceId, userId, role } = tenantOf(request);
    if (role === 'MEMBER') return reply.status(403).send({ message: 'Apenas administradores registram pagamento.' });
    const { id } = request.params as { id: string };
    const body = z.object({ note: z.string().max(500).optional(), paymentMethod: z.string().default('manual') }).parse(request.body || {});
    const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId } });
    if (!invoice) return reply.status(404).send({ message: 'Fatura não encontrada' });
    if (invoice.status === 'paid') return reply.status(409).send({ message: 'Fatura já paga.' });

    const paid = await markInvoicePaid(invoice, { paymentMethod: body.paymentMethod, note: body.note, gateway: 'manual' });
    await audit(workspaceId, userId, 'billing.manual_payment', 'invoice', id, { number: invoice.number, note: body.note });
    return reply.send(paid);
  });

  fastify.get('/invoices/:id/events', guard, async (request, reply) => {
    const { workspaceId } = tenantOf(request);
    const { id } = request.params as { id: string };
    const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!invoice) return reply.status(404).send({ message: 'Fatura não encontrada' });
    const events = await prisma.paymentEvent.findMany({ where: { invoiceId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return reply.send(events);
  });
}
