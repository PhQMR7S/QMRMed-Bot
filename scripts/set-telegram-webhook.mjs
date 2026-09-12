import { createHash } from 'node:crypto';

if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
  console.log(`Skipping Telegram webhook configuration for Vercel ${process.env.VERCEL_ENV} deployment.`);
  process.exit(0);
}

const token = process.env.BOT_TOKEN?.trim();
const configuredUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.MINI_APP_URL?.trim();
const baseUrl = configuredUrl ? (/^https:\/\//i.test(configuredUrl) ? configuredUrl : `https://${configuredUrl}`).replace(/\/$/, '') : '';

if (!token) throw new Error('BOT_TOKEN is required to configure Telegram webhook');
if (!baseUrl || !/^https:\/\//i.test(baseUrl)) throw new Error('A valid production HTTPS URL is required to configure Telegram webhook');

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

const verifyResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const verifyResult = await verifyResponse.json();
if (!verifyResponse.ok || !verifyResult.ok) {
  throw new Error(`Telegram getWebhookInfo failed: ${verifyResult.description ?? verifyResponse.statusText}`);
}

const info = verifyResult.result;
if (info.url !== webhookUrl) {
  throw new Error(`Telegram webhook verification failed: expected ${webhookUrl}, got ${info.url || '(empty)'}`);
}
if (info.last_error_message) {
  console.warn(`Telegram webhook reports a previous delivery error: ${info.last_error_message}`);
}
console.log(`Telegram webhook verified: ${webhookUrl}`);
