import { db } from './db.js';
import { config } from './config.js';

export function isAdmin(telegramId: number | string) {
  return config.adminIds.has(String(telegramId));
}

export async function ensureTrial(userId: number) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!config.TRIAL_ENABLED || user.trialUsed) return user;

  const started = new Date();
  const ends = new Date(started.getTime() + config.TRIAL_DAYS * 86_400_000);
  return db.user.update({
    where: { id: userId },
    data: { trialUsed: true, trialStartedAt: started, trialEndsAt: ends },
  });
}

export async function hasPremiumAccess(userId: number) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.plan !== 'FREE') return true;
  return Boolean(user.trialEndsAt && user.trialEndsAt > new Date());
}
