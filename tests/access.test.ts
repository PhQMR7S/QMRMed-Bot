import assert from 'node:assert/strict';
import test from 'node:test';
import { isActiveSubscription } from '../src/access.js';

test('accepts a currently active subscription', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  assert.equal(isActiveSubscription({ active: true, startsAt: new Date('2026-09-01T00:00:00.000Z'), endsAt: new Date('2026-10-01T00:00:00.000Z') }, now), true);
});

test('rejects expired, future, and inactive subscriptions', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  assert.equal(isActiveSubscription({ active: true, startsAt: new Date('2026-08-01T00:00:00.000Z'), endsAt: new Date('2026-09-10T11:59:59.000Z') }, now), false);
  assert.equal(isActiveSubscription({ active: true, startsAt: new Date('2026-09-10T12:00:01.000Z'), endsAt: new Date('2026-10-01T00:00:00.000Z') }, now), false);
  assert.equal(isActiveSubscription({ active: false, startsAt: new Date('2026-09-01T00:00:00.000Z'), endsAt: new Date('2026-10-01T00:00:00.000Z') }, now), false);
});

test('subscription end boundary is exclusive', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  assert.equal(isActiveSubscription({ active: true, startsAt: new Date('2026-09-01T00:00:00.000Z'), endsAt: now }, now), false);
});
