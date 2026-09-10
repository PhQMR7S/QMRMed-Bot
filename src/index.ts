import { Bot, Context, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { db, upsertTelegramUser } from './db.js';
import { answerMedicalQuestion, omniChat } from './ai.js';
import { formatRetrievedContext, searchApprovedContent } from './content-search.js';
import { backMenu, mainMenu, subjectMenu, topicMenu, lessonMenu, adminMenu, adminDriveMenu } from './menu.js';
import { ensureTrial, hasPremiumAccess, isAdmin } from './access.js';
import { canUseInButtonQuiz, isAnswerCorrect, isQuizExpired, resolveSelectedValue } from './quiz.js';
import { getAdminDashboard, getDriveStatus, runAdminDriveSync, getContentBreakdown } from './admin-panel.js';

const bot = new Bot(config.BOT_TOKEN);
type PendingAction = 'search' | 'ai' | 'broadcast';
const pending = new Map<string, PendingAction>();

type QuizSession = {
  ids: number[];
  index: number;
  correct: number;
  answered: number;
  ministerial: boolean;
  exam: boolean;
  startedAt: number;
};
const sessions = new Map<string, QuizSession>();

const TELEGRAM_TEXT_LIMIT = 3900;

async function getUser(ctx: Context) {
  if (!ctx.from) throw new Error('Missing Telegram user');
  return upsertTelegramUser(ctx.from);
}

function userKey(ctx: Context) {
  return `${ctx.chat?.id ?? 'private'}:${ctx.from?.id ?? ''}`;
}

function splitTelegramText(text: string, limit = TELEGRAM_TEXT_LIMIT) {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.6)) cut = remaining.lastIndexOf(' ', limit);
    if (cut < Math.floor(limit * 0.6)) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function replyLong(ctx: Context, text: string, replyMarkup?: InlineKeyboard) {
  const chunks = splitTelegramText(text);
  for (let i = 0; i < chunks.length; i++) {
    await ctx.reply(chunks[i], i === chunks.length - 1 && replyMarkup ? { reply_markup: replyMarkup } : undefined);
  }
}

function answerKeyboard(type: 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER', options: unknown, qid: number) {
  const keyboard = new InlineKeyboard();
  if (type === 'TRUE_FALSE') {
    keyboard.text('✅ صحيح', `ans:${qid}:صحيح`).row();
    keyboard.text('❌ خطأ', `ans:${qid}:خطأ`).row();
  } else if (Array.isArray(options)) {
    for (let i = 0; i < options.length; i++) {
      const value = typeof options[i] === 'string' ? options[i] : JSON.stringify(options[i]);
      keyboard.text(value.slice(0, 60), `ans:${qid}:${i}`).row();
    }
  } else if (options && typeof options === 'object') {
    for (const [key, value] of Object.entries(options)) keyboard.text(`${key}. ${String(value).slice(0, 50)}`, `ans:${qid}:${key}`).row();
  }
  return keyboard.text('🏠 إنهاء', 'quiz:stop');
}

async function home(ctx: Context) {
  const user = await getUser(ctx);
  const trial = user.trialEndsAt && user.trialEndsAt > new Date()
    ? `🎁 التجربة حتى ${user.trialEndsAt.toLocaleDateString('ar-IQ')}`
    : '🔓 التجربة غير مفعلة';
  await ctx.reply(`🩺 QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية.\n\n${trial}\n💎 الخطة: ${user.plan}\n\nاختر القسم:`, { reply_markup: mainMenu });
}

async function showSubjects(ctx: Context, prefix = 'subject') {
  const subjects = await db.subject.findMany({ orderBy: { order: 'asc' } });
  if (!subjects.length) return ctx.editMessageText('لا توجد مواد مضافة حاليًا.', { reply_markup: backMenu });
  await ctx.editMessageText('📚 اختر المادة الدراسية:', { reply_markup: subjectMenu(subjects, prefix) });
}

async function showQuestion(ctx: Context, key: string) {
  const session = sessions.get(key);
  if (!session || session.index >= session.ids.length) return finishQuiz(ctx, key);
  if (isQuizExpired(session, Date.now())) return finishQuiz(ctx, key, true);
  const question = await db.question.findUnique({ where: { id: session.ids[session.index] } });
  if (!question || !canUseInButtonQuiz(question)) return finishQuiz(ctx, key);
  const label = session.exam ? `🧠 الاختبار — سؤال ${session.index + 1}/${session.ids.length}` : `❓ تدريب — سؤال ${session.index + 1}/${session.ids.length}`;
  await replyLong(ctx, `${label}\n\n${question.text}`, answerKeyboard(question.type, question.options, question.id));
}

async function startQuiz(ctx: Context, subjectId: number, ministerial: boolean, exam: boolean) {
  const user = await getUser(ctx);
  if (!(await hasPremiumAccess(user.id))) return ctx.editMessageText('🔒 هذا القسم يحتاج اشتراكًا أو تجربة مفعلة.', { reply_markup: backMenu });
  const questions = await db.question.findMany({ where: { subjectId, isMinisterial: ministerial, type: { in: ['MCQ', 'TRUE_FALSE'] } }, select: { id: true } });
  if (!questions.length) return ctx.editMessageText('لا توجد أسئلة متاحة لهذه المادة حاليًا.', { reply_markup: backMenu });
  const ids = questions.map((q) => q.id).sort(() => Math.random() - 0.5).slice(0, 10);
  const key = userKey(ctx);
  sessions.set(key, { ids, index: 0, correct: 0, answered: 0, ministerial, exam, startedAt: Date.now() });
  await ctx.editMessageText(exam ? '🧠 بدأ الاختبار. لديك 15 دقيقة كحد أقصى.' : '❓ بدأ التدريب. أجب عن الأسئلة بالترتيب.');
  await showQuestion(ctx, key);
}

async function finishQuiz(ctx: Context, key: string, timedOut = false) {
  const session = sessions.get(key);
  sessions.delete(key);
  if (!session) return;
  const total = session.ids.length;
  const accuracy = session.answered ? Math.round((session.correct / session.answered) * 100) : 0;
  const unanswered = Math.max(total - session.answered, 0);
  await ctx.reply(`${session.exam ? '🏁 انتهى الاختبار' : '🏁 انتهى التدريب'}${timedOut ? '\n⏰ انتهى الوقت.' : ''}\n\nالنتيجة: ${session.correct}/${session.answered}\nالدقة: ${accuracy}%${unanswered ? `\n⏳ غير مجاب: ${unanswered}` : ''}`, { reply_markup: backMenu });
}

bot.command('start', async (ctx) => {
  const user = await getUser(ctx);
  if (config.TRIAL_ENABLED && !user.trialUsed) await ensureTrial(user.id);
  await home(ctx);
});
bot.command('help', async (ctx) => ctx.reply('استخدم /start لفتح لوحة QMRMed. جميع الأقسام الأساسية متاحة من الأزرار، والبحث والمساعد الذكي يعملان عبر OmniRoute وفق إعدادات المنصة.'));

bot.callbackQuery('home', async (ctx) => { await ctx.answerCallbackQuery(); pending.delete(userKey(ctx)); sessions.delete(userKey(ctx)); await home(ctx); });
bot.callbackQuery('subjects', async (ctx) => { await ctx.answerCallbackQuery(); await showSubjects(ctx); });
bot.callbackQuery(/^subject:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const subject = await db.subject.findUnique({ where: { id: Number(ctx.match[1]) }, include: { topics: { orderBy: { order: 'asc' } } } });
  if (!subject) return ctx.editMessageText('المادة غير موجودة.', { reply_markup: backMenu });
  await ctx.editMessageText(`📖 ${subject.name}\n\n${subject.description ?? 'اختر الموضوع:'}`, { reply_markup: topicMenu(subject.topics, subject.id) });
});
bot.callbackQuery(/^topic:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const topic = await db.topic.findUnique({ where: { id: Number(ctx.match[1]) }, include: { lessons: { orderBy: { order: 'asc' } } } });
  if (!topic) return ctx.editMessageText('الموضوع غير موجود.', { reply_markup: backMenu });
  await ctx.editMessageText(`📘 ${topic.name}\n\nاختر الدرس:`, { reply_markup: lessonMenu(topic.lessons, topic.id, Number(ctx.match[2])) });
});
bot.callbackQuery(/^topicback:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const subject = await db.subject.findUnique({ where: { id: Number(ctx.match[2]) }, include: { topics: { orderBy: { order: 'asc' } } } });
  if (!subject) return ctx.editMessageText('المادة غير موجودة.', { reply_markup: backMenu });
  await ctx.editMessageText(`📖 ${subject.name}\n\nاختر الموضوع:`, { reply_markup: topicMenu(subject.topics, subject.id) });
});
bot.callbackQuery(/^lesson:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const lesson = await db.lesson.findUnique({ where: { id: Number(ctx.match[1]) }, include: { topic: true } });
  if (!lesson) return ctx.editMessageText('الدرس غير موجود.', { reply_markup: backMenu });
  const user = await getUser(ctx);
  const progress = await db.progress.upsert({ where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } }, create: { userId: user.id, lessonId: lesson.id, completed: false }, update: {} });
  const keyboard = new InlineKeyboard().text(progress.completed ? '✅ مكتمل' : '☑️ تعليم كمكتمل', `complete:${lesson.id}`).row().text('⬅️ الموضوع', `topicback:${lesson.topicId}:${lesson.topic.subjectId}`).row().text('🏠 الرئيسية', 'home');
  await replyLong(ctx, `📖 ${lesson.title}\n\n${lesson.content}\n\n${lesson.source ? `📚 المصدر: ${lesson.source}` : ''}`, keyboard);
});
bot.callbackQuery(/^complete:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery('تم حفظ التقدم');
  const user = await getUser(ctx);
  await db.progress.upsert({ where: { userId_lessonId: { userId: user.id, lessonId: Number(ctx.match[1]) } }, create: { userId: user.id, lessonId: Number(ctx.match[1]), completed: true }, update: { completed: true } });
  await ctx.editMessageReplyMarkup({ reply_markup: backMenu });
});

bot.callbackQuery('question_bank', async (ctx) => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'qbsubject'); });
bot.callbackQuery('ministerial', async (ctx) => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'mqsubject'); });
bot.callbackQuery(/^qbsubject:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), false, false); });
bot.callbackQuery(/^mqsubject:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), true, false); });
bot.callbackQuery('exams', async (ctx) => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'examsubject'); });
bot.callbackQuery(/^examsubject:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), false, true); });

bot.callbackQuery(/^ans:(\d+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const key = userKey(ctx);
  const session = sessions.get(key);
  if (!session) return ctx.reply('انتهت الجلسة. ابدأ تدريبًا جديدًا من القائمة.');
  if (isQuizExpired(session, Date.now())) return finishQuiz(ctx, key, true);
  const questionId = Number(ctx.match[1]);
  const selected = ctx.match[2];
  if (session.ids[session.index] !== questionId) return ctx.reply('⚠️ هذا السؤال لم يعد فعالًا. استخدم آخر سؤال ظاهر أمامك.');
  const question = await db.question.findUnique({ where: { id: questionId } });
  if (!question || !canUseInButtonQuiz(question)) return ctx.reply('⚠️ تعذر معالجة هذا السؤال.');
  const selectedValue = resolveSelectedValue(question, selected);
  const correct = isAnswerCorrect(question, selected);
  const user = await getUser(ctx);
  if (correct) session.correct++;
  session.answered++;
  session.index++;
  await db.attempt.create({ data: { userId: user.id, questionId: question.id, answer: selectedValue, correct } });
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(correct ? '✅ صحيح' : `❌ خطأ — الصحيح: ${question.answer}`, 'quiz:noop') });
  if (session.index >= session.ids.length) return finishQuiz(ctx, key);
  await showQuestion(ctx, key);
});
bot.callbackQuery('quiz:stop', async (ctx) => { await ctx.answerCallbackQuery(); await finishQuiz(ctx, userKey(ctx)); });
bot.callbackQuery('quiz:noop', async (ctx) => ctx.answerCallbackQuery());

bot.callbackQuery('progress', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx);
  const [completed, attempts, correct] = await Promise.all([db.progress.count({ where: { userId: user.id, completed: true } }), db.attempt.count({ where: { userId: user.id } }), db.attempt.count({ where: { userId: user.id, correct: true } })]);
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
  await ctx.editMessageText(`📊 تقدمي\n\nالدروس المكتملة: ${completed}\nالمحاولات: ${attempts}\nالإجابات الصحيحة: ${correct}\nالدقة: ${accuracy}%`, { reply_markup: backMenu });
});
bot.callbackQuery('study_mode', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('🎯 وضع الدراسة\n\nاختر القسم والمرحلة من المواد الدراسية. سيتم توسيع التخصيص حسب تفضيلات المستخدم في الإصدار القادم.', { reply_markup: backMenu }); });
bot.callbackQuery('search', async (ctx) => { await ctx.answerCallbackQuery(); pending.set(userKey(ctx), 'search'); await ctx.editMessageText('🔎 أرسل كلمة أو عبارة للبحث داخل محتوى QMRMed المعتمد فقط.', { reply_markup: new InlineKeyboard().text('❌ إلغاء', 'home') }); });
bot.callbackQuery('ai', async (ctx) => { await ctx.answerCallbackQuery(); pending.set(userKey(ctx), 'ai'); await ctx.editMessageText('🤖 أرسل سؤالك الطبي. سأبحث أولًا في محتوى QMRMed المعتمد ثم أجيب منه فقط.', { reply_markup: new InlineKeyboard().text('❌ إلغاء', 'home') }); });
bot.callbackQuery('trial', async (ctx) => { await ctx.answerCallbackQuery(); const user = await getUser(ctx); if (user.trialUsed) return ctx.editMessageText('🎁 تم استخدام التجربة المجانية لهذا الحساب بالفعل.', { reply_markup: backMenu }); const updated = await ensureTrial(user.id); await ctx.editMessageText(`🎁 تم تفعيل التجربة المجانية.\nتنتهي في: ${updated.trialEndsAt?.toLocaleString('ar-IQ') ?? '-'}`, { reply_markup: backMenu }); });
bot.callbackQuery('plans', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('💎 اشتراكات QMRMed\n\n🆓 FREE — المحتوى الأساسي\n💙 PLUS — مزايا دراسية موسعة\n💜 PRO — الوصول الكامل\n\nسيتم ربط الدفع الفعلي عبر Telegram Stars قبل الإنتاج. لا يتم اعتبار الضغط على الزر عملية دفع.', { reply_markup: new InlineKeyboard().text('💙 PLUS', 'plan:PLUS').text('💜 PRO', 'plan:PRO').row().text('⬅️ الرئيسية', 'home') }); });
bot.callbackQuery(/^plan:(PLUS|PRO)$/, async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText(`💎 ${ctx.match[1]}\n\nهذه الواجهة جاهزة لربط Telegram Stars/بوابة الدفع. لن يتم تفعيل الاشتراك إلا بعد وصول تأكيد الدفع والتحقق منه.`, { reply_markup: backMenu }); });
bot.callbackQuery('settings', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('⚙️ الإعدادات\n\n🎯 المرحلة والقسم من «وضع الدراسة».\n🔔 الإشعارات والتذكيرات ستضاف مع طبقة الإشعارات.\n🌐 لغة الواجهة محفوظة كقابلية توسعة.', { reply_markup: backMenu }); });
bot.callbackQuery('about', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('ℹ️ QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية، تجمع المحتوى الدراسي، بنك الأسئلة، الوزاريات، الاختبارات، التقدم والمساعد الذكي في تجربة واحدة.', { reply_markup: backMenu }); });

function adminGuard(ctx: Context) {
  return isAdmin(ctx.from?.id ?? '');
}

bot.callbackQuery(/^admin(?::.*)?$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!adminGuard(ctx)) return ctx.editMessageText('غير مصرح.');
  const data = ctx.callbackQuery.data;
  try {
    if (data === 'admin:stats') {
      const d = await getAdminDashboard();
      return ctx.editMessageText(`📊 Dashboard QMRMed\n\n👥 المستخدمون: ${d.users}\n🆓 FREE: ${d.free}\n💙 PLUS: ${d.plus}\n💜 PRO: ${d.pro}\n\n📚 المواد: ${d.subjects}\n📘 المواضيع: ${d.topics}\n📖 الدروس: ${d.lessons}\n❓ بنك الأسئلة: ${d.questions}\n📝 الوزاريات: ${d.ministerialQuestions}\n🎯 المحاولات: ${d.attempts}\n\n☁️ المصادر المعتمدة: ${d.approvedSources}\n🔎 المصادر المفهرسة: ${d.indexedSources}\n🧩 المقاطع: ${d.chunks}`, { reply_markup: adminMenu() });
    }
    if (data === 'admin:users') {
      const d = await getAdminDashboard();
      return ctx.editMessageText(`👥 المستخدمون\n\nإجمالي: ${d.users}\nFREE: ${d.free}\nPLUS: ${d.plus}\nPRO: ${d.pro}`, { reply_markup: adminMenu() });
    }
    if (data === 'admin:content') {
      const d = await getAdminDashboard();
      const breakdown = await getContentBreakdown();
      const labels: Record<string, string> = { SOURCE: '📚 Sources', REFERENCE: '📖 References', QUESTION: '❓ Question Bank', MINISTERIAL: '📝 Ministerial', CASE: '🩺 Cases' };
      const kinds = breakdown.map((item) => `${labels[item.kind] ?? item.kind}: ${item.count}`).join('\n');
      return ctx.editMessageText(`📚 المحتوى\n\n${kinds}\n\nالمواد: ${d.subjects}\nالمواضيع: ${d.topics}\nالدروس: ${d.lessons}\nالأسئلة المنظمة: ${d.questions}\nالوزاريات المنظمة: ${d.ministerialQuestions}\n\nالمصادر المعتمدة: ${d.approvedSources}\nالمصادر المفهرسة: ${d.indexedSources}\nالمقاطع المفهرسة: ${d.chunks}`, { reply_markup: adminMenu() });
    }
    if (data === 'admin:questions') {
      const d = await getAdminDashboard();
      return ctx.editMessageText(`📝 الأسئلة والوزاريات\n\n❓ بنك الأسئلة: ${d.questions}\n📝 الوزاريات: ${d.ministerialQuestions}\n🎯 المحاولات: ${d.attempts}\n\nالوصول الفعلي للأسئلة يخضع لخطة المستخدم/التجربة كما هو معرف في طبقة الصلاحيات.`, { reply_markup: adminMenu() });
    }
    if (data === 'admin:drive') {
      const status = await getDriveStatus();
      if (!status.configured) return ctx.editMessageText('☁️ Google Drive\n\n❌ غير مُهيأ.\n\nأضف GOOGLE_DRIVE_ROOT_FOLDER_ID وبيانات Service Account إلى بيئة تشغيل البوت.', { reply_markup: adminDriveMenu() });
      const state = status.state;
      return ctx.editMessageText(`☁️ Google Drive\n\nالحالة: مُهيأ\nRoot Folder ID: ${status.rootFolderId}\n\nآخر تشغيل: ${state?.lastRunAt?.toLocaleString('ar-IQ') ?? '-'}\nآخر نجاح: ${state?.lastSuccessAt?.toLocaleString('ar-IQ') ?? '-'}\nالملفات المقروءة: ${state?.filesSeen ?? 0}\nالملفات المفهرسة في آخر تشغيل: ${state?.filesIndexed ?? 0}\n${state?.lastError ? `❌ آخر خطأ: ${state.lastError}` : '✅ لا يوجد خطأ مسجل'}`, { reply_markup: adminDriveMenu() });
    }
    if (data === 'admin:drive:status') {
      const status = await getDriveStatus();
      if (!status.configured) return ctx.editMessageText('☁️ Google Drive غير مُهيأ حاليًا.', { reply_markup: adminDriveMenu() });
      const state = status.state;
      return ctx.editMessageText(`☁️ حالة Google Drive\n\nRoot: ${status.rootFolderId}\nآخر تشغيل: ${state?.lastRunAt?.toLocaleString('ar-IQ') ?? '-'}\nآخر نجاح: ${state?.lastSuccessAt?.toLocaleString('ar-IQ') ?? '-'}\nملفات: ${state?.filesSeen ?? 0}\nمفهرسة: ${state?.filesIndexed ?? 0}\n${state?.lastError ? `❌ ${state.lastError}` : '✅ آخر تشغيل ناجح/بدون خطأ مسجل'}`, { reply_markup: adminDriveMenu() });
    }
    if (data === 'admin:drive:sync') {
      const status = await getDriveStatus();
      if (!status.configured) return ctx.editMessageText('❌ لا يمكن بدء المزامنة: Google Drive غير مُهيأ.', { reply_markup: adminDriveMenu() });
      await ctx.editMessageText('🔄 جاري مزامنة Google Drive وفهرسة المحتوى…');
      const result = await runAdminDriveSync();
      return ctx.editMessageText(`✅ اكتملت مزامنة Google Drive\n\n📄 الملفات المقروءة: ${result.filesSeen}\n🔎 الملفات المفهرسة/المحدثة: ${result.filesIndexed}\n⏭️ الملفات المتخطاة: ${result.filesSkipped}\n🗑️ الملفات التي أزيل فهرسها: ${result.filesRemoved}\n🧩 المقاطع الجديدة: ${result.chunks}`, { reply_markup: adminDriveMenu() });
    }
    if (data === 'admin:broadcast') {
      pending.set(userKey(ctx), 'broadcast');
      return ctx.editMessageText('📣 أرسل الآن رسالة الإرسال الجماعي. سيتم إرسالها للمستخدمين المسجلين.', { reply_markup: backMenu });
    }
    if (data === 'admin:ai') {
      const result = await omniChat([{ role: 'user', content: 'Reply only: QMRMed OmniRoute OK' }], { temperature: 0 });
      return ctx.editMessageText(`🤖 OmniRoute يعمل.\n\n${result}`, { reply_markup: adminMenu() });
    }
    return ctx.editMessageText('🛠️ لوحة الإدارة', { reply_markup: adminMenu() });
  } catch (error) {
    console.error('Admin action failed:', error);
    return ctx.editMessageText(`❌ تعذر تنفيذ العملية.\n\n${error instanceof Error ? error.message : String(error)}`, { reply_markup: data.startsWith('admin:drive') ? adminDriveMenu() : adminMenu() });
  }
});

bot.callbackQuery('admin', async (ctx) => { await ctx.answerCallbackQuery(); if (!adminGuard(ctx)) return ctx.editMessageText('غير مصرح.'); await ctx.editMessageText('🛠️ لوحة الإدارة', { reply_markup: adminMenu() }); });
bot.command('admin', async (ctx) => { if (!adminGuard(ctx)) return ctx.reply('غير مصرح.'); await ctx.reply('🛠️ لوحة الإدارة', { reply_markup: adminMenu() }); });

bot.on('message:text', async (ctx) => {
  const user = await getUser(ctx);
  const key = userKey(ctx);
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  const action = pending.get(key);
  if (!action) return ctx.reply('استخدم /start لفتح لوحة QMRMed.', { reply_markup: mainMenu });
  pending.delete(key);

  if (action === 'broadcast') {
    if (!isAdmin(ctx.from.id)) return ctx.reply('غير مصرح.');
    const users = await db.user.findMany({ select: { telegramId: true } });
    let sent = 0;
    for (const target of users) {
      try { await ctx.api.sendMessage(target.telegramId, `📣 QMRMed\n\n${text}`); sent++; } catch { /* Continue after blocked/deleted chats. */ }
    }
    return ctx.reply(`✅ اكتمل الإرسال. نجح: ${sent}/${users.length}`);
  }

  if (action === 'search') {
    try {
      const results = await searchApprovedContent(text, { take: 10 });
      if (!results.length) return ctx.reply('لم أجد نتيجة مطابقة داخل محتوى QMRMed المعتمد.');
      const context = formatRetrievedContext(results, 10_000);
      return replyLong(ctx, `🔎 نتائج البحث داخل QMRMed المعتمد:\n\n${context}`);
    } catch (error) {
      console.error(error);
      return ctx.reply('⚠️ تعذر البحث في محتوى QMRMed حاليًا. تأكد من تشغيل مزامنة Google Drive وقاعدة البيانات ثم حاول مرة أخرى.');
    }
  }

  try {
    const response = await answerMedicalQuestion(text, '');
    return replyLong(ctx, `🤖 QMRMed AI\n\n${response}`);
  } catch (error) {
    console.error(error);
    return ctx.reply('⚠️ تعذر الوصول إلى المساعد الذكي حاليًا. تأكد من إعداد OmniRoute ثم حاول مرة أخرى.');
  }
});

bot.catch((err) => console.error('QMRMed Bot error:', err.error));
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
bot.start({ onStart: (info) => console.log(`@${info.username} is running`) });
