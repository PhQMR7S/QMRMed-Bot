import type { Context } from 'grammy';
import { db } from './db.js';
import { config } from './config.js';
import type { Plan, Prisma } from '@prisma/client';

export type PaidPlan = Exclude<Plan, 'FREE'>;
export type PlanDuration = 30 | 150 | 365;
export type DbTx = Prisma.TransactionClient;

export function planPrice(plan: PaidPlan, days: PlanDuration) {
  if (plan === 'PLUS') {
    if (days === 30) return config.PLUS_MONTH_STARS;
    if (days === 150) return config.PLUS_5MONTH_STARS;
    return config.PLUS_YEAR_STARS;
  }
  if (days === 30) return config.PRO_MONTH_STARS;
  if (days === 150) return config.PRO_5MONTH_STARS;
  return config.PRO_YEAR_STARS;
}

export function planDays(days: PlanDuration) {
  return days;
}

export function planDurationLabel(days: PlanDuration) {
  if (days === 30) return 'شهر واحد';
  if (days === 150) return '5 أشهر';
  return 'سنة واحدة';
}

export function paymentPlanLabel(plan: PaidPlan) {
  return plan === 'PLUS' ? 'PLUS' : 'PRO';
}

export function paymentPayload(plan: PaidPlan, days: PlanDuration, userTelegramId: number, nonce: string) {
  return `qmrmed|${plan}|${days}|${userTelegramId}|${nonce}`;
}

export function parsePaymentPayload(payload: string) {
  const [prefix, plan, daysText, telegramId, nonce] = payload.split('|');
  const days = Number(daysText);
  if (prefix !== 'qmrmed' || (plan !== 'PLUS' && plan !== 'PRO') || ![30, 150, 365].includes(days) || !/^\d+$/.test(telegramId) || !nonce) return null;
  return { plan: plan as PaidPlan, days: days as PlanDuration, telegramId, nonce };
}

export async function sendStarsInvoice(ctx: Context, plan: PaidPlan, days: PlanDuration) {
  const price = planPrice(plan, days);
  if (!price) throw new Error(`سعر ${plan} غير مضبوط.`);
  if (!ctx.chat?.id || !ctx.from?.id) throw new Error('لا يمكن إنشاء فاتورة خارج محادثة مستخدم صالحة.');
  const nonce = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const payload = paymentPayload(plan, days, ctx.from.id, nonce);
  await ctx.api.sendInvoice(
    ctx.chat.id,
    `QMRMed ${paymentPlanLabel(plan)} — ${planDurationLabel(days)}`,
    `اشتراك ${paymentPlanLabel(plan)} لمدة ${planDurationLabel(days)}`,
    payload,
    'XTR',
    [{ label: `QMRMed ${paymentPlanLabel(plan)}`, amount: price }],
  );
}

export async function validatePreCheckout(payload: string, fromTelegramId: number, currency: string, totalAmount: number) {
  const parsed = parsePaymentPayload(payload);
  if (!parsed) return { ok: false as const, reason: 'بيانات الفاتورة غير صالحة.' };
  if (parsed.telegramId !== String(fromTelegramId)) return { ok: false as const, reason: 'الفاتورة ليست مرتبطة بهذا الحساب.' };
  if (currency !== 'XTR') return { ok: false as const, reason: 'العملة المطلوبة يجب أن تكون Telegram Stars.' };
  const expected = planPrice(parsed.plan, parsed.days);
  if (!expected || expected !== totalAmount) return { ok: false as const, reason: 'قيمة الفاتورة لا تطابق السعر الحالي.' };
  return { ok: true as const, parsed };
}

export async function activateSubscriptionInTransaction(tx: DbTx, userId: number, plan: PaidPlan, days: number, provider: string, externalId?: string) {
  const now = new Date();
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const current = await tx.subscription.findFirst({ where: { userId, plan, active: true, endsAt: { gt: now } }, orderBy: { endsAt: 'desc' } });
  const start = current?.endsAt && current.endsAt > now ? current.endsAt : now;
  const ends = new Date(start.getTime() + days * 86_400_000);
  if (current) {
    await tx.subscription.update({ where: { id: current.id }, data: { endsAt: ends, active: true, externalId: externalId ?? current.externalId } });
  } else {
    await tx.subscription.create({ data: { userId, plan, provider, externalId, startsAt: start, endsAt: ends, active: true } });
  }
  return tx.user.update({ where: { id: user.id }, data: { plan } });
}

export async function recordSuccessfulStarsPayment(userId: number, payload: string, currency: string, totalAmount: number, telegramChargeId: string, providerChargeId: string) {
  const parsed = parsePaymentPayload(payload);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { telegramId: true } });
  if (!parsed || parsed.telegramId !== user.telegramId || currency !== 'XTR' || planPrice(parsed.plan, parsed.days) !== totalAmount) throw new Error('Invalid payment payload or amount.');
  return db.$transaction(async tx => {
    const existing = await tx.paymentTransaction.findUnique({ where: { telegramPaymentChargeId: telegramChargeId } });
    if (existing?.status === 'PAID') return { alreadyProcessed: true, plan: parsed.plan, days: parsed.days };
    const payment = existing
      ? await tx.paymentTransaction.update({ where: { id: existing.id }, data: { status: 'PAID', currency, amount: totalAmount, providerPaymentChargeId: providerChargeId } })
      : await tx.paymentTransaction.create({ data: { userId, plan: parsed.plan, provider: 'TELEGRAM_STARS', currency, amount: totalAmount, payload, telegramPaymentChargeId: telegramChargeId, providerPaymentChargeId: providerChargeId, status: 'PAID' } });
    await activateSubscriptionInTransaction(tx, userId, parsed.plan, parsed.days, 'TELEGRAM_STARS', payment.id.toString());
    return { alreadyProcessed: false, plan: parsed.plan, days: parsed.days };
  });
}
