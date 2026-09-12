import { db } from './db.js';
import { config } from './config.js';
import { getEffectivePlan, isWithinWindow } from './entitlements.js';

export function isAdmin(telegramId: number | string) {
  return config.adminIds.has(String(telegramId));
}

export function isActiveSubscription(
  subscription: { active: boolean; startsAt: Date; endsAt: Date } | null | undefined,
  now = new Date(),
) {
  return isWithinWindow(subscription, now);
}

export async function ensureTrial(userId: number) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!config.TRIAL_ENABLED || user.trialUsed) return user;

  const started = new Date();
  const ends = new Date(started.getTime() + config.TRIAL_DAYS * 86_400_000);

  const claimed = await db.user.updateMany({
    where: { id: userId, trialUsed: false },
    data: { trialUsed: true, trialStartedAt: started, trialEndsAt: ends },
  });

  if (claimed.count === 0) return db.user.findUniqueOrThrow({ where: { id: userId } });
  return db.user.findUniqueOrThrow({ where: { id: userId } });
}

export async function hasPremiumAccess(userId: number) {
  return (await getEffectivePlan(userId)) !== 'FREE';
}
