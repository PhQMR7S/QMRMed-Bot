import { Bot, Context, InlineKeyboard } from 'grammy';
import { db, upsertTelegramUser } from './db.js';
import { hasPremiumAccess } from './access.js';
import { answerExam, getExamForUser, remainingExamSeconds, startExam } from './exam-sessions.js';

function telegramUserId(ctx: Context) {
  if (!ctx.from) throw new Error('Missing Telegram user');
  return ctx.from.id;
}

function answerKeyboard(question: { id: string; options: unknown; prompt: string }) {
  const keyboard = new InlineKeyboard();
  if (question.options && typeof question.options === 'object' && !Array.isArray(question.options)) {
    for (const [key, value] of Object.entries(question.options as Record<string, unknown>)) {
      keyboard.text(`${key}. ${String(value).slice(0, 55)}`, `dex:a:${question.id}:${key}`).row();
    }
  } else if (Array.isArray(question.options)) {
    question.options.forEach((value, index) => keyboard.text(`${index + 1}. ${String(value).slice(0, 55)}`, `dex:a:${question.id}:${index}`).row());
  } else {
    keyboard.text('✅ صحيح', `dex:a:${question.id}:صحيح`).row();
    keyboard.text('❌ خطأ', `dex:a:${question.id}:خطأ`).row();
  }
  return keyboard.text('⏹️ إنهاء الاختبار', 'dex:stop');
}

async function renderQuestion(ctx: Context, sessionId: string, userId: number) {
  const session = await getExamForUser(sessionId, userId);
  if (!session) return ctx.reply('لم أجد جلسة اختبار محفوظة.', { reply_markup: new InlineKeyboard().text('🧠 الاختبارات', 'exams') });
  if (session.status === 'EXPIRED') return ctx.reply('⏰ انتهى وقت الاختبار. يمكنك بدء اختبار جديد.', { reply_markup: new InlineKeyboard().text('🧠 اختبار جديد', 'exams') });
  if (session.status === 'COMPLETED') return showResult(ctx, session);
  const question = session.questions[session.currentIndex];
  if (!question) return showResult(ctx, session);
  const remaining = remainingExamSeconds(session.expiresAt);
  return ctx.reply(`🧠 ${session.title}\n\n⏱️ المتبقي: ${remaining} ثانية\nالسؤال ${session.currentIndex + 1}/${session.questionCount}\n\n${question.prompt}`, { reply_markup: answerKeyboard(question) });
}

async function showResult(ctx: Context, session: { score: number; questionCount: number; status: string; id: string }) {
  const accuracy = session.questionCount ? Math.round((session.score / session.questionCount) * 100) : 0;
  return ctx.reply(`🏁 انتهى الاختبار\n\nالنتيجة: ${session.score}/${session.questionCount}\nالدقة: ${accuracy}%`, { reply_markup: new InlineKeyboard().text('🔄 اختبار جديد', 'exams').row().text('📊 تقدمي', 'progress').row().text('🏠 الرئيسية', 'home') });
}

async function showExamList(ctx: Context) {
  const subjects = await db.subject.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { id: true, name: true } });
  const keyboard = new InlineKeyboard();
  for (const subject of subjects) keyboard.text(subject.name, `dex:start:${subject.id}`).row();
  keyboard.text('▶️ استئناف آخر اختبار', 'dex:resume').row().text('🏠 الرئيسية', 'home');
  return ctx.reply('🧠 الاختبارات\n\nاختر المادة لبدء اختبار محفوظ وقابل للاستئناف. مدة الاختبار 10 دقائق.', { reply_markup: keyboard });
}

async function startDurableExam(ctx: Context, subjectId: number) {
  const user = await upsertTelegramUser({ id: telegramUserId(ctx), username: ctx.from?.username, first_name: ctx.from?.first_name, last_name: ctx.from?.last_name });
  if (!(await hasPremiumAccess(user.id))) return ctx.reply('🔒 الاختبارات تحتاج اشتراكًا أو تجربة مفعلة.');
  const questions = await db.question.findMany({ where: { subjectId, type: { in: ['MCQ', 'TRUE_FALSE'] } }, orderBy: [{ difficulty: 'asc' }, { id: 'asc' }], take: 40 });
  if (questions.length < 5) return ctx.reply('لا توجد أسئلة كافية لهذه المادة لبدء اختبار محفوظ.');
  const selected = questions.sort(() => Math.random() - 0.5).slice(0, Math.min(10, questions.length));
  const session = await startExam({
    userId: user.id,
    title: `اختبار ${subjectId}`,
    questionCount: selected.length,
    questions: selected.map(question => ({ prompt: question.text, options: question.options, correct: question.answer, explanation: question.explanation, questionId: question.id })),
  });
  await ctx.reply(`🚀 بدأ الاختبار وحُفظت الجلسة.\n⏱️ لديك 10 دقائق ويمكنك الاستئناف بعد الانقطاع.`);
  return renderQuestion(ctx, session.id, user.id);
}

async function resumeDurableExam(ctx: Context) {
  const user = await upsertTelegramUser({ id: telegramUserId(ctx), username: ctx.from?.username, first_name: ctx.from?.first_name, last_name: ctx.from?.last_name });
  const session = await db.examSession.findFirst({ where: { userId: user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
  if (!session) return ctx.reply('لا يوجد اختبار نشط يمكن استئنافه.', { reply_markup: new InlineKeyboard().text('🧠 الاختبارات', 'exams') });
  return renderQuestion(ctx, session.id, user.id);
}

export function registerDurableExamHandlers(bot: Bot) {
  bot.callbackQuery('exams', async ctx => { await ctx.answerCallbackQuery(); return showExamList(ctx); });
  bot.callbackQuery('dex:resume', async ctx => { await ctx.answerCallbackQuery(); return resumeDurableExam(ctx); });
  bot.callbackQuery(/^dex:start:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); return startDurableExam(ctx, Number(ctx.match[1])); });
  bot.callbackQuery(/^dex:a:([^:]+):(.+)$/, async ctx => {
    const user = await upsertTelegramUser({ id: telegramUserId(ctx), username: ctx.from?.username, first_name: ctx.from?.first_name, last_name: ctx.from?.last_name });
    const active = await db.examSession.findFirst({ where: { userId: user.id, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } });
    if (!active) { await ctx.answerCallbackQuery('لا يوجد اختبار نشط.'); return; }
    const questionId = ctx.match[1];
    const answer = ctx.match[2];
    const result = await answerExam(active.id, user.id, questionId, answer);
    await ctx.answerCallbackQuery(result.isCorrect ? '✅ إجابة صحيحة' : '❌ إجابة غير صحيحة');
    if (result.isCorrect) await ctx.reply(`✅ صحيح${result.question.explanation ? `\n\n💡 ${result.question.explanation}` : ''}`);
    else await ctx.reply(`❌ غير صحيح${result.question.explanation ? `\n\n💡 ${result.question.explanation}` : ''}`);
    return renderQuestion(ctx, active.id, user.id);
  });
  bot.callbackQuery('dex:stop', async ctx => {
    await ctx.answerCallbackQuery();
    const user = await upsertTelegramUser({ id: telegramUserId(ctx), username: ctx.from?.username, first_name: ctx.from?.first_name, last_name: ctx.from?.last_name });
    await db.examSession.updateMany({ where: { userId: user.id, status: 'ACTIVE' }, data: { status: 'CANCELLED', completedAt: new Date() } });
    return ctx.reply('⏹️ تم حفظ الإجابات وإنهاء الاختبار الحالي.');
  });
  bot.command('resume_exam', resumeDurableExam);
}
