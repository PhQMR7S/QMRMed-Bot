import { db } from './db.js';
import { config } from './config.js';

export type PlanName = 'FREE' | 'PLUS' | 'PRO';

export type SubscriptionWindow = {
  active: boolean;
  startsAt: Date;
  endsAt: Date;
  plan: PlanName;
};

export function isWithinWindow(
  window: Pick<SubscriptionWindow, 'active' | 'startsAt' | 'endsAt'> | null | undefined,
  now = new Date(),
) {
  return Boolean(
    window &&
      window.active &&
      window.startsAt <= now &&
      window.endsAt > now,
  );
}

export function resolveEffectivePlan(input: {
  userPlan: PlanName;
  trialEndsAt?: Date | null;
  subscription?: SubscriptionWindow | null;
  now?: Date;
}): PlanName {
  const now = input.now ?? new Date();
  if (input.trialEndsAt && input.trialEndsAt > now) return 'PRO';
  if (input.subscription && isWithinWindow(input.subscription, now)) {
    return input.subscription.plan;
  }
  return input.userPlan;
}

export async function getEffectivePlan(userId: number, now = new Date()): Promise<PlanName> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { plan: true, trialEndsAt: true },
  });

  const subscription = await db.subscription.findFirst({
    where: {
      userId,
      active: true,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    select: { active: true, startsAt: true, endsAt: true, plan: true },
    orderBy: { endsAt: 'desc' },
  });

  return resolveEffectivePlan({
    userPlan: user.plan,
    trialEndsAt: user.trialEndsAt,
    subscription,
    now,
  });
}

export async function hasPremiumEntitlement(userId: number, now = new Date()) {
  if (!config.TRIAL_ENABLED) {
    const plan = await getEffectivePlan(userId, now);
    return plan !== 'FREE';
  }
  return (await getEffectivePlan(userId, now)) !== 'FREE';
}
