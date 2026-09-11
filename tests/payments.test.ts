import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { parsePaymentPayload, paymentPayload, planDurationLabel, planPrice, validatePreCheckout } from '../src/payments.js';

test('payment payload round-trips supported plans and durations', () => {
  const payload = paymentPayload('PLUS', 150, 123456789, 'nonce-1');
  assert.deepEqual(parsePaymentPayload(payload), {
    plan: 'PLUS',
    days: 150,
    telegramId: '123456789',
    nonce: 'nonce-1',
  });
});

test('invalid payment payloads are rejected', () => {
  assert.equal(parsePaymentPayload('qmrmed|FREE|30|123|x'), null);
  assert.equal(parsePaymentPayload('qmrmed|PLUS|31|123|x'), null);
  assert.equal(parsePaymentPayload('qmrmed|PLUS|30|abc|x'), null);
  assert.equal(parsePaymentPayload('qmrmed|PLUS|30|123|'), null);
});

test('plan pricing and duration labels stay aligned', () => {
  assert.equal(planPrice('PLUS', 30), config.PLUS_MONTH_STARS);
  assert.equal(planPrice('PLUS', 150), config.PLUS_5MONTH_STARS);
  assert.equal(planPrice('PLUS', 365), config.PLUS_YEAR_STARS);
  assert.equal(planPrice('PRO', 30), config.PRO_MONTH_STARS);
  assert.equal(planPrice('PRO', 150), config.PRO_5MONTH_STARS);
  assert.equal(planPrice('PRO', 365), config.PRO_YEAR_STARS);
  assert.equal(planDurationLabel(30), 'شهر واحد');
  assert.equal(planDurationLabel(150), '5 أشهر');
  assert.equal(planDurationLabel(365), 'سنة واحدة');
});

test('pre-checkout rejects wrong user, currency, and amount', async () => {
  const payload = paymentPayload('PRO', 30, 123456789, 'nonce-2');
  const expected = planPrice('PRO', 30);
  assert.equal((await validatePreCheckout(payload, 987654321, 'XTR', expected)).ok, false);
  assert.equal((await validatePreCheckout(payload, 123456789, 'USD', expected)).ok, false);
  assert.equal((await validatePreCheckout(payload, 123456789, 'XTR', expected + 1)).ok, false);
  assert.equal((await validatePreCheckout(payload, 123456789, 'XTR', expected)).ok, true);
});
