import 'dotenv/config';

const token = process.env.BOT_TOKEN;
const omniUrl = (process.env.OMNIROUTE_URL ?? '').replace(/\/$/, '');
const omniKey = process.env.OMNIROUTE_API_KEY;
const model = process.env.OMNIROUTE_MODEL ?? 'auto';

if (!token) throw new Error('BOT_TOKEN is not configured');
if (!omniUrl) throw new Error('OMNIROUTE_URL is not configured');
if (!omniKey) throw new Error('OMNIROUTE_API_KEY is not configured');

const telegram = await fetch(`https://api.telegram.org/bot${token}/getMe`);
const telegramBody = await telegram.text();
if (!telegram.ok) throw new Error(`Telegram getMe ${telegram.status}: ${telegramBody.slice(0, 500)}`);
const telegramData = JSON.parse(telegramBody) as { ok?: boolean; result?: { username?: string } };
if (!telegramData.ok) throw new Error(`Telegram getMe returned ok=false: ${telegramBody.slice(0, 500)}`);

const omni = await fetch(`${omniUrl}/v1/chat/completions`, {
  method: 'POST',
  headers: { authorization: `Bearer ${omniKey}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply only: QMRMed OmniRoute SMOKE TEST OK' }], temperature: 0 }),
});
const omniBody = await omni.text();
if (!omni.ok) throw new Error(`OmniRoute ${omni.status}: ${omniBody.slice(0, 500)}`);
const omniData = JSON.parse(omniBody) as { choices?: Array<{ message?: { content?: string } }> };
const response = omniData.choices?.[0]?.message?.content?.trim();
if (!response) throw new Error('OmniRoute returned an empty response');

console.log(`Telegram OK: @${telegramData.result?.username ?? 'unknown'}`);
console.log(`OmniRoute OK: ${response}`);
