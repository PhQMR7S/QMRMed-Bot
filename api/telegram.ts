import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, GrammyError, webhookCallback } from 'grammy';
import { registerFileAiAskBridge } from '../src/file-ai-ask-bridge.js';
import { registerFileAiV4Handlers } from '../src/file-ai-v4.js';
import { registerDurableExamHandlers } from '../src/durable-exam-telegram.js';
import { installTelegramCustomEmoji, preloadTelegramCustomEmojiCatalog } from '../src/telegram-custom-emoji.js';

function isLegacyExamFilter(filter: unknown) {
  if (typeof filter === 'string') return filter === 'exams' || filter.startsWith('ans:') || filter.startsWith('quiz:');
  if (filter instanceof RegExp) return /ans|quiz/i.test(filter.source);
  return false;
}

function isTelegramNoOp(error: unknown) {
  if (!(error instanceof GrammyError)) return false;
  return error.error_code === 400 && /message is not modified/i.test(error.description);
}

let botInstance: Bot | undefined;
let startHook: ((info: unknown) => void | Promise<void>) | undefined;
const originalStart = (Bot.prototype as any).start;
const originalCallbackQuery = (Bot.prototype as any).callbackQuery;
(Bot.prototype as any).start = function (options?: { onStart?: (info: unknown) => void | Promise<void> }) {
  botInstance = this as Bot;
  startHook = options?.onStart;
  return Promise.resolve();
};
(Bot.prototype as any).callbackQuery = function (filter: unknown, ...args: unknown[]) {
  if (isLegacyExamFilter(filter)) return this;
  return originalCallbackQuery.call(this, filter, ...args);
};
await import('../src/index.js');
(Bot.prototype as any).start = originalStart;
(Bot.prototype as any).callbackQuery = originalCallbackQuery;
if (!botInstance) throw new Error('QMRMed bot instance was not initialized');
const bot = botInstance;
registerFileAiAskBridge(bot);
registerFileAiV4Handlers(bot);
registerDurableExamHandlers(bot);
const secretToken = createHash('sha256').update(bot.token).digest('hex');
const handleUpdate = webhookCallback(bot, 'http', { secretToken, timeoutMilliseconds: 9_000 });
let initialized: Promise<void> | undefined;
async function initializeBot() {
  if (!initialized) initialized = (async () => {
    console.log(JSON.stringify({ event: 'telegram_webhook_initializing' }));
    await bot.init();
    // IMPORTANT: load the catalog before installing the API transformer.
    // getStickerSet must bypass our outgoing-message transformer; installing it
    // first causes recursive transformer -> loadCatalog -> getStickerSet calls.
    await preloadTelegramCustomEmojiCatalog(bot);
    installTelegramCustomEmoji(bot);
    if (startHook) await startHook(bot.botInfo);
    console.log(JSON.stringify({ event: 'telegram_webhook_initialized', username: bot.botInfo.username }));
  })();
  return initialized;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  console.log(JSON.stringify({ event: 'telegram_webhook_request', method: req.method }));
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }
  const suppliedSecret = req.headers['x-telegram-bot-api-secret-token'];
  const received = Array.isArray(suppliedSecret) ? suppliedSecret[0] : suppliedSecret;
  if (received !== secretToken) {
    console.warn(JSON.stringify({ event: 'telegram_webhook_unauthorized' }));
    res.statusCode = 401;
    res.end('Unauthorized');
    return;
  }
  try {
    await initializeBot();
    return await handleUpdate(req, res);
  } catch (error) {
    if (isTelegramNoOp(error)) {
      console.info(JSON.stringify({ event: 'telegram_webhook_noop', reason: 'message_not_modified' }));
      if (!res.headersSent) {
        res.statusCode = 200;
        res.end('OK');
      }
      return;
    }
    console.error(JSON.stringify({
      event: 'telegram_webhook_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  }
}
