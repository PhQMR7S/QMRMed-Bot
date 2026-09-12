import { createHash } from 'node:crypto';

const token = process.env.BOT_TOKEN?.trim();
const baseUrl = process.env.MINI_APP_URL?.trim().replace(/\/$/, '');

if (!token) throw new Error('BOT_TOKEN is required to configure Telegram webhook');
if (!baseUrl || !/^https:\/\//i.test(baseUrl)) throw new Error('MINI_APP_URL must be an HTTPS URL');

const webhookUrl = `${baseUrl}/api/telegram`;
const secretToken = createHash('sha256').update(token).digest('hex');

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secretToken,
    drop_pending_updates: false,
  }),
});

const result = await response.json();
if (!response.ok || !result.ok) {
  throw new Error(`Telegram setWebhook failed: ${result.description ?? response.statusText}`);
}

console.log(`Telegram webhook configured: ${webhookUrl}`);
