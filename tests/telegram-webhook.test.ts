import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const webhook = await readFile(new URL('../api/telegram.ts', import.meta.url), 'utf8');
const setup = await readFile(new URL('../scripts/set-telegram-webhook.mjs', import.meta.url), 'utf8');

void test('Telegram webhook uses the existing QMRMed bot graph', () => {
  assert.match(webhook, /await import\('\.\.\/src\/index\.js'\)/);
  assert.match(webhook, /webhookCallback\(bot, 'http'/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /secretToken/);
});

void test('Vercel build configures the production Telegram webhook', () => {
  assert.match(setup, /BOT_TOKEN/);
  assert.match(setup, /MINI_APP_URL/);
  assert.match(setup, /\/api\/telegram/);
  assert.match(setup, /setWebhook/);
  assert.match(setup, /drop_pending_updates: false/);
});
