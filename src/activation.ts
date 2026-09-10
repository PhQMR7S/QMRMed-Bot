import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import type { Plan } from '@prisma/client';
import { activateSubscription } from './payments.js';

export type PaidPlan = Exclude<Plan, 'FREE'>;

function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function generateActivationCode() {
  return `QMR-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export async function createActivationCode(createdByTelegramId: string, plan: PaidPlan, durationDays: number, maxUses = 1) {
  for (let i = 0; i < 5; i++) {
    const code = generateActivationCode();
    try {
      return await db.activationCode.create({ data: { code, plan, durationDays, maxUses, createdByTelegramId } });
    } catch (error) {
      if (i === 4) throw error;
    }
  }
  throw new Error('تعذر إنشاء الكود.');
}

export async function redeemActivationCode(userId: number, rawCode: string) {
  const code = normalizeCode(rawCode);
  return db.$transaction(async tx => {
    const activation = await tx.activationCode.findUnique({ where: { code } });
    if (!activation || !activation.active) throw new Error('الكود غير صالح أو غير فعال.');
    if (activation.expiresAt && activation.expiresAt <= new Date()) throw new Error('انتهت صلاحية هذا الكود.');
    if (activation.usedCount >= activation.maxUses) throw new Error('تم استنفاد هذا الكود.');
    const prior = await tx.activationCodeRedemption.findUnique({ where: { codeId_userId: { codeId: activation.id, userId } } });
    if (prior) throw new Error('تم استخدام هذا الكود على حسابك سابقًا.');
    await tx.activationCodeRedemption.create({ data: { codeId: activation.id, userId } });
    const updated = await tx.activationCode.update({ where: { id: activation.id }, data: { usedCount: { increment: 1 }, active: activation.usedCount + 1 >= activation.maxUses ? false : true } });
    return { activation: updated, plan: activation.plan, durationDays: activation.durationDays };
  }).then(async result => {
    await activateSubscription(userId, result.plan, result.durationDays, 'ACTIVATION_CODE', result.activation.code);
    return result;
  });
}
