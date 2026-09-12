import test from 'node:test';
import assert from 'node:assert/strict';
import { isWithinWindow, resolveEffectivePlan } from '../src/entitlements.js';

const now = new Date('2026-09-12T12:00:00.000Z');

test('accepts only active subscriptions inside their time window', () => {
  assert.equal(isWithinWindow({ active: true, startsAt: new Date('2026-09-12T11:00:00Z'), endsAt: new Date('2026-09-12T13:00:00Z') }, now), true);
  assert.equal(isWithinWindow({ active: true, startsAt: new Date('2026-09-12T13:00:00Z'), endsAt: new Date('2026-09-12T14:00:00Z') }, now), false);
  assert.equal(isWithinWindow({ active: false, startsAt: new Date('2026-09-12T11:00:00Z'), endsAt: new Date('2026-09-12T13:00:00Z') }, now), false);
});

test('prefers a live trial over the stored plan', () => {
  assert.equal(resolveEffectivePlan({ userPlan: 'FREE', trialEndsAt: new Date('2026-09-13T00:00:00Z'), now }), 'PRO');
});

test('uses the active subscription plan when there is no live trial', () => {
  assert.equal(resolveEffectivePlan({
    userPlan: 'FREE',
    trialEndsAt: new Date('2026-09-11T00:00:00Z'),
    subscription: { plan: 'PLUS', active: true, startsAt: new Date('2026-09-12T11:00:00Z'), endsAt: new Date('2026-09-13T00:00:00Z') },
    now,
  }), 'PLUS');
});

test('falls back to the stored user plan', () => {
  assert.equal(resolveEffectivePlan({ userPlan: 'PLUS', trialEndsAt: null, now }), 'PLUS');
  assert.equal(resolveEffectivePlan({ userPlan: 'FREE', trialEndsAt: null, now }), 'FREE');
});
