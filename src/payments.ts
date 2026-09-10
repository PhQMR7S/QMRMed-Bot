import type { Context } from 'grammy';
import { db } from './db.js';
import { config } from './config.js';
import type { Plan, Prisma } from '@prisma/client';

export type PaidPlan = Exclude<Plan, 'FREE'>;
export type DbTx = Prisma.TransactionClient;

export function planPrice(plan: PaidPlan) {
  return plan === 'PLUS' ? config.PLUS_STARS : config.PRO_STARS;
}

export function planDays(plan: PaidPlan) {
  return plan === 'PLUS' ? config.PLUS_DAYS : config.PRO_DAYS;
}

export function paymentPlanLabel(plan: PaidPlan) {
  return plan === 'PLUS' ? 'PLUS' : 'PRO';
}

export function paymentPayload(plan: PaidPlan, userTelegramId: number, nonce: string) {
  return `qmrmed|${plan}|${planDays(plan)}|${userTelegramId}|${nonce}`;
}

export function parsePaymentPayload(payload: string) {
  const [prefix, plan, days, telegramId, nonce] = payload.split('|');
  if (prefix !== 'qmrmed' || (plan !== 'PLUS' && plan !== 'PRO') || !/^\d+$/.test(days) || !/^\d+$/.test(telegramId) || !nonce) return null;
  return { plan: plan as PaidPlan, days: Number(days), telegramId, nonce };
}

export async function sendStarsInvoice(ctx: Context, plan: PaidPlan) {
  const price = planPrice(plan);
  if (!price) throw new Error(`سعر ${plan} عبر Telegram Stars غير مضبوط بعد. اضبط ${plan === 'PLUS' ? 'PLUS_STARS' : 'PRO_STARS'}.`);
  if (!ctx.chat?.id || !ctx.from?.id) throw new Error('لا يمكن إنشاء فاتورة خارج محادثة مستخدم صالحة.');
  const nonce = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const payload = paymentPayload(plan, ctx.from.id, nonce);
  await ctx.api.sendInvoice(
    ctx.chat.id,
    `QMRMed ${paymentPlanLabel(plan)}`,
    `اشتراك ${paymentPlanLabel(plan)} لمدة ${planDays(plan)} يومًا`,
    payload,
    '',
    'XTR',
    [{ label: `QMRMed ${paymentPlanLabel(plan)}`, amount: price }],
  );
}

export async function validatePreCheckout(payload: string, fromTelegramId: number, currency: string, totalAmount: number) {
  const parsed = parsePaymentPayload(payload);
  if (!parsed) return { ok: false as const, reason: 'بيانات الفاتورة غير صالحة.' };
  if (parsed.telegramId !== String(fromTelegramId)) return { ok: false as const, reason: 'الفاتورة ليست مرتبطة بهذا الحساب.' };
  if (currency !== 'XTR') return { ok: false as const, reason: 'العملة المطلوبة يجب أن تكون Telegram Stars.' };
  const expected = planPrice(parsed.plan);
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

export async function activateSubscription(userId: number, plan: PaidPlan, days: number, provider: string, externalId?: string) {
  return db.$transaction(tx => activateSubscriptionInTransaction(tx, userId, plan, days, provider, externalId));
}

export async function recordSuccessfulStarsPayment(userId: number, payload: string, currency: string, totalAmount: number, telegramChargeId: string, providerChargeId: string) {
  const parsed = parsePaymentPayload(payload);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { telegramId: true } });
  if (!parsed || parsed.telegramId !== user.telegramId || currency !== 'XTR' || planPrice(parsed.plan) !== totalAmount) throw new Error('Invalid payment payload or amount.');
  return db.$transaction(async tx => {
    const existing = await tx.paymentTransaction.findUnique({ where: { telegramPaymentChargeId: telegramChargeId } });
    if (existing?.status === 'PAID') return { alreadyProcessed: true, plan: parsed.plan };
    const payment = existing
      ? await tx.paymentTransaction.update({ where: { id: existing.id }, data: { status: 'PAID', currency, amount: totalAmount, providerPaymentChargeId: providerChargeId } })
      : await tx.paymentTransaction.create({ data: { userId, plan: parsed.plan, provider: 'TELEGRAM_STARS', currency, amount: totalAmount, payload, telegramPaymentChargeId: telegramChargeId, providerPaymentChargeId: providerChargeId, status: 'PAID' } });
    await activateSubscriptionInTransaction(tx, userId, parsed.plan, parsed.days, 'TELEGRAM_STARS', payment.id.toString());
    return { alreadyProcessed: false, plan: parsed.plan };
  });
}
