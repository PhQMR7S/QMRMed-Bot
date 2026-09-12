import { Bot, Context } from 'grammy';
import { randomUUID } from 'node:crypto';
import { db, upsertTelegramUser } from './db.js';
import { enqueueJob } from './ai-jobs.js';

const MARKER = '⁣QMRMED_FILE_ASK:';

export function registerFileAiAskBridge(bot: Bot) {
  bot.callbackQuery(/^filev3:ask:([^:]+)$/, async (ctx, next) => {
    const fileId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.reply(`🔎 أرسل الآن سؤالك عن هذا الملف في رسالة واحدة.\n\n${MARKER}${fileId}`);
    return;
  });

  bot.on('message:text', async (ctx, next) => {
    const replyText = ctx.message.reply_to_message && 'text' in ctx.message.reply_to_message ? String(ctx.message.reply_to_message.text ?? '') : '';
    const index = replyText.indexOf(MARKER);
    if (index < 0) return next();
    const fileId = replyText.slice(index + MARKER.length).split(/\s|\n/)[0];
    if (!fileId) return ctx.reply('تعذر تحديد الملف. افتح الملف ثم اختر «اسأل الملف» مرة أخرى.');
    const user = await getUser(ctx);
    const file = await db.file.findFirst({ where: { id: fileId, userId: user.id, status: 'READY' }, select: { id: true } });
    if (!file) return ctx.reply('الملف غير متاح حاليًا.');
    const operation = await db.fileOperation.create({ data: { id: randomUUID(), userId: user.id, fileId, type: 'ASK_FILE', requestKey: `${fileId}:ASK_FILE:${randomUUID()}`, parameters: { question: ctx.message.text }, status: 'QUEUED' } });
    const job = await enqueueJob({ userId: user.id, type: 'FILE_RESULT', fileId, idempotencyKey: `result:${operation.id}`, payload: { operationId: operation.id } });
    await db.fileOperation.update({ where: { id: operation.id }, data: { jobId: job.id } });
    return ctx.reply('⏳ تم استلام سؤالك ووضعه في المعالجة. ستصل الإجابة هنا بعد اكتمالها.');
  });
}

async function getUser(ctx: Context) {
  if (!ctx.from) throw new Error('Missing Telegram user');
  return upsertTelegramUser(ctx.from);
}
