import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, webhookCallback } from 'grammy';

// The existing bot module contains the complete QMRMed handler graph and starts
// long polling at the end. For Vercel we intercept only that transport call,
// capture the same Bot instance, and expose it through grammY's HTTP webhook
// adapter. No command, callback, payment, AI, quiz, admin, or DB handler is
// duplicated here.
let botInstance: Bot | undefined;
let startHook: ((info: unknown) => void | Promise<void>) | undefined;

const botPrototype = Bot.prototype as Bot['__proto__'] & { start: unknown };
const originalStart = (botPrototype as any).start;
(botPrototype as any).start = function (options?: { onStart?: (info: unknown) => void | Promise<void> }) {
  botInstance = this as Bot;
  startHook = options?.onStart;
  return Promise.resolve();
};

await import('../src/index.js');
(botPrototype as any).start = originalStart;

if (!botInstance) throw new Error('QMRMed bot instance was not initialized');
const bot = botInstance;
const secretToken = createHash('sha256').update(bot.token).digest('hex');
const handleUpdate = webhookCallback(bot, 'http', { secretToken, timeoutMilliseconds: 9_000 });

let initialized: Promise<void> | undefined;
async function initializeBot() {
  if (!initialized) {
    initialized = (async () => {
      await bot.init();
      if (startHook) await startHook(bot.botInfo);
    })();
  }
  return initialized;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }

  const suppliedSecret = req.headers['x-telegram-bot-api-secret-token'];
  const received = Array.isArray(suppliedSecret) ? suppliedSecret[0] : suppliedSecret;
  if (received !== secretToken) {
    res.statusCode = 401;
    res.end('Unauthorized');
    return;
  }

  await initializeBot();
  return handleUpdate(req, res);
}
