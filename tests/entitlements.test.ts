import { describe, expect, it } from 'vitest';
import { isWithinWindow, resolveEffectivePlan } from '../src/entitlements.js';

describe('entitlements', () => {
  const now = new Date('2026-09-12T12:00:00.000Z');

  it('accepts only active subscriptions inside their time window', () => {
    expect(isWithinWindow({ active: true, startsAt: new Date('2026-09-12T11:00:00Z'), endsAt: new Date('2026-09-12T13:00:00Z') }, now)).toBe(true);
    expect(isWithinWindow({ active: true, startsAt: new Date('2026-09-12T13:00:00Z'), endsAt: new Date('2026-09-12T14:00:00Z') }, now)).toBe(false);
    expect(isWithinWindow({ active: false, startsAt: new Date('2026-09-12T11:00:00Z'), endsAt: new Date('2026-09-12T13:00:00Z') }, now)).toBe(false);
  });

  it('prefers a live trial over the stored plan', () => {
    expect(resolveEffectivePlan({ userPlan: 'FREE', trialEndsAt: new Date('2026-09-13T00:00:00Z'), now })).toBe('PRO');
  });

  it('uses the active subscription plan when there is no live trial', () => {
    expect(resolveEffectivePlan({
      userPlan: 'FREE',
      trialEndsAt: new Date('2026-09-11T00:00:00Z'),
      subscription: { plan: 'PLUS', active: true, startsAt: new Date('2026-09-12T11:00:00Z'), endsAt: new Date('2026-09-13T00:00:00Z') },
      now,
    })).toBe('PLUS');
  });

  it('falls back to the stored user plan', () => {
    expect(resolveEffectivePlan({ userPlan: 'PLUS', trialEndsAt: null, now })).toBe('PLUS');
    expect(resolveEffectivePlan({ userPlan: 'FREE', trialEndsAt: null, now })).toBe('FREE');
  });
});
