import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

process.env.BOT_TOKEN = 'test-bot-token';
process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/qmrmed';
process.env.MINI_APP_BOT_USERNAME = 'QMRMedBot';

const { validateInitData } = await import('../src/miniapp.js');

function signedInitData(authDate: number, user = { id: 12345, first_name: 'Test', username: 'tester' }) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user) });
  const dataCheck = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN!).digest();
  const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('valid Telegram initData is accepted and returns the signed user', () => {
  const user = validateInitData(signedInitData(1_700_000_000), 1_700_000_000);
  assert.equal(user.id, 12345);
  assert.equal(user.username, 'tester');
});

test('tampered Telegram initData is rejected', () => {
  const data = signedInitData(1_700_000_000).replace('12345', '99999');
  assert.throws(() => validateInitData(data, 1_700_000_000), /AUTH_INVALID/);
});

test('expired Telegram initData is rejected', () => {
  assert.throws(() => validateInitData(signedInitData(1_700_000_000), 1_700_000_000 + 3601), /AUTH_EXPIRED/);
});
