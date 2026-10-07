import type { Invoice, Plan, Subscription } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function addMonth(date: Date) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  // 31/01 + 1 mês = 28/02 (não 03/03)
  if (d.getDate() < day) d.setDate(0);
  return d;
}

/** Toda cobrança parte de uma assinatura. Workspace sem assinatura recebe o plano padrão. */
export async function ensureSubscription(workspaceId: string): Promise<Subscription & { plan: Plan }> {
  const existing = await prisma.subscription.findUnique({ where: { workspaceId }, include: { plan: true } });
  if (existing) return existing;

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  if (!plans.length) throw new Error('Nenhum plano cadastrado. Rode o seed de planos.');
  const plan = plans.find((p) => p.name.toLowerCase() === (workspace?.plan || '').toLowerCase()) || plans[0];

  const start = new Date();
  return prisma.subscription.create({
    data: { workspaceId, planId: plan.id, currentPeriodStart: start, currentPeriodEnd: addMonth(start) },
    include: { plan: true },
  });
}

export async function cycleUsage(workspaceId: string, sub: Subscription & { plan: Plan }) {
  const [workspace, aiUsage, executions] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId } }),
    prisma.usageRecord.aggregate({
      where: { workspaceId, createdAt: { gte: sub.currentPeriodStart } },
      _sum: { estimatedCost: true, tokensInput: true, tokensOutput: true },
    }),
    prisma.agentExecution.count({ where: { workspaceId, sandbox: false, queuedAt: { gte: sub.currentPeriodStart } } }),
  ]);

  const creditsUsed = workspace?.creditsUsed ?? 0;
  const overageCredits = Math.max(0, creditsUsed - sub.plan.creditsIncluded);
  return {
    creditsUsed,
    creditsIncluded: sub.plan.creditsIncluded,
    overageCredits,
    overageCents: overageCredits * sub.plan.overageCentsPerCredit,
    aiCostUsd: aiUsage._sum.estimatedCost || 0,
    tokens: (aiUsage._sum.tokensInput || 0) + (aiUsage._sum.tokensOutput || 0),
    executions,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
  };
}

async function nextNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count({ where: { number: { startsWith: `${year}-` } } });
  return `${year}-${String(count + 1).padStart(4, '0')}`;
}

/**
 * Fecha o ciclo: gera a fatura com mensalidade + excedente de créditos medido de verdade,
 * zera o contador de créditos e avança o período da assinatura.
 */
export async function closeCycle(workspaceId: string, opts: { force?: boolean } = {}): Promise<Invoice> {
  const sub = await ensureSubscription(workspaceId);
  if (!opts.force && sub.currentPeriodEnd > new Date()) {
    throw new Error(`O ciclo atual termina em ${sub.currentPeriodEnd.toLocaleDateString('pt-BR')}. Use "fechar mesmo assim" para antecipar.`);
  }
  const usage = await cycleUsage(workspaceId, sub);

  const lines = [
    { descricao: `Plano ${sub.plan.name}`, quantidade: 1, valorUnitarioCents: sub.plan.priceCents, totalCents: sub.plan.priceCents },
    ...(usage.overageCredits > 0
      ? [{
          descricao: `Créditos excedentes (${usage.overageCredits} acima dos ${sub.plan.creditsIncluded} inclusos)`,
          quantidade: usage.overageCredits,
          valorUnitarioCents: sub.plan.overageCentsPerCredit,
          totalCents: usage.overageCents,
        }]
      : []),
  ];
  const total = lines.reduce((n, l) => n + l.totalCents, 0);
  const dueDate = new Date(Date.now() + 7 * 86_400_000);

  const invoice = await prisma.invoice.create({
    data: {
      workspaceId,
      number: await nextNumber(),
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      subtotalCents: sub.plan.priceCents,
      overageCents: usage.overageCents,
      totalCents: total,
      status: total === 0 ? 'paid' : 'open',
      paidAt: total === 0 ? new Date() : null,
      dueDate,
      lines: lines as any,
    },
  });

  const start = new Date();
  await prisma.$transaction([
    prisma.subscription.update({ where: { workspaceId }, data: { currentPeriodStart: start, currentPeriodEnd: addMonth(start) } }),
    prisma.workspace.update({ where: { id: workspaceId }, data: { creditsUsed: 0 } }),
  ]);
  return invoice;
}

/** Faturas vencidas e ainda abertas passam a 'overdue' (lido no painel). */
export async function refreshOverdue(workspaceId: string) {
  await prisma.invoice.updateMany({
    where: { workspaceId, status: 'open', dueDate: { lt: new Date() } },
    data: { status: 'overdue' },
  });
}

export async function markInvoicePaid(invoice: Invoice, data: { paymentMethod?: string; note?: string; gateway?: string; externalId?: string }) {
  return prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: 'paid',
      paidAt: new Date(),
      paymentMethod: data.paymentMethod ?? invoice.paymentMethod,
      note: data.note ?? invoice.note,
      gateway: data.gateway ?? invoice.gateway,
      externalId: data.externalId ?? invoice.externalId,
    },
  });
}
