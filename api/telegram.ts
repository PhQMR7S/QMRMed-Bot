import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, webhookCallback } from 'grammy';
import { registerFileAiAskBridge } from '../src/file-ai-ask-bridge.js';
import { registerFileAiV3Handlers } from '../src/file-ai-v3.js';

let botInstance: Bot | undefined;
let startHook: ((info: unknown) => void | Promise<void>) | undefined;

const originalStart = (Bot.prototype as any).start;
(Bot.prototype as any).start = function (options?: { onStart?: (info: unknown) => void | Promise<void> }) {
  botInstance = this as Bot;
  startHook = options?.onStart;
  return Promise.resolve();
};

await import('../src/index.js');
(Bot.prototype as any).start = originalStart;

if (!botInstance) throw new Error('QMRMed bot instance was not initialized');
const bot = botInstance;
registerFileAiAskBridge(bot);
registerFileAiV3Handlers(bot);

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
