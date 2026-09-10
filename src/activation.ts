import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import type { Plan } from '@prisma/client';
import { activateSubscriptionInTransaction } from './payments.js';

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

    const claimed = await tx.activationCode.updateMany({
      where: { id: activation.id, active: true, usedCount: { lt: activation.maxUses } },
      data: { usedCount: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new Error('تم استنفاد هذا الكود أو تم استخدامه الآن.');

    const updated = await tx.activationCode.findUniqueOrThrow({ where: { id: activation.id } });
    if (updated.usedCount >= updated.maxUses) {
      await tx.activationCode.update({ where: { id: updated.id }, data: { active: false } });
    }

    await tx.activationCodeRedemption.create({ data: { codeId: activation.id, userId } });
    await activateSubscriptionInTransaction(tx, userId, activation.plan as PaidPlan, activation.durationDays, 'ACTIVATION_CODE', activation.code);
    return { activation: updated, plan: activation.plan as PaidPlan, durationDays: activation.durationDays };
  });
}
