import { Bot, Context, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { db, upsertTelegramUser } from './db.js';
import { answerMedicalQuestion } from './ai.js';
import { formatRetrievedContext, searchApprovedContent } from './content-search.js';
import { routedChat, aiRoutingSummary } from './ai-routing.js';
import { backMenu, mainMenu, subjectMenu, topicMenu, lessonMenu, adminMenu, adminDriveMenu, studyDepartmentMenu, studyStageMenu } from './menu.js';
import { ensureTrial, hasPremiumAccess, isAdmin } from './access.js';
import { canUseInButtonQuiz, isAnswerCorrect, isQuizExpired, resolveSelectedValue } from './quiz.js';
import { getAdminDashboard, getDriveStatus, runAdminDriveSync, getContentBreakdown } from './admin-panel.js';

const bot = new Bot(config.BOT_TOKEN);
const TELEGRAM_TEXT_LIMIT = 3900;
type PendingAction = 'search' | 'ai' | 'broadcast';
type QuizSession = { ids: number[]; index: number; correct: number; answered: number; ministerial: boolean; exam: boolean; startedAt: number };
const pending = new Map<string, PendingAction>();
const sessions = new Map<string, QuizSession>();

function userKey(ctx: Context) {
  return `${ctx.chat?.id ?? 'private'}:${ctx.from?.id ?? ''}`;
}

async function getUser(ctx: Context) {
  if (!ctx.from) throw new Error('Missing Telegram user');
  return upsertTelegramUser(ctx.from);
}

function splitTelegramText(text: string, limit = TELEGRAM_TEXT_LIMIT) {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = Math.max(rest.lastIndexOf('\n', limit), rest.lastIndexOf(' ', limit));
    if (cut < Math.floor(limit * 0.6)) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [''];
}

async function replyLong(ctx: Context, text: string, markup?: InlineKeyboard) {
  const chunks = splitTelegramText(text);
  for (let i = 0; i < chunks.length; i++) {
    await ctx.reply(chunks[i], i === chunks.length - 1 && markup ? { reply_markup: markup } : undefined);
  }
}

async function render(ctx: Context, text: string, markup?: InlineKeyboard) {
  if (ctx.callbackQuery?.message) {
    return ctx.editMessageText(text, markup ? { reply_markup: markup } : undefined);
  }
  return ctx.reply(text, markup ? { reply_markup: markup } : undefined);
}

function answerKeyboard(type: 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER', options: unknown, questionId: number) {
  const keyboard = new InlineKeyboard();
  if (type === 'TRUE_FALSE') {
    keyboard.text('✅ صحيح', `ans:${questionId}:صحيح`).row();
    keyboard.text('❌ خطأ', `ans:${questionId}:خطأ`).row();
  } else if (Array.isArray(options)) {
    for (let i = 0; i < options.length; i++) keyboard.text(String(options[i]).slice(0, 60), `ans:${questionId}:${i}`).row();
  } else if (options && typeof options === 'object') {
    for (const [key, value] of Object.entries(options)) keyboard.text(`${key}. ${String(value).slice(0, 50)}`, `ans:${questionId}:${key}`).row();
  }
  return keyboard.text('🏠 إنهاء', 'quiz:stop');
}

async function home(ctx: Context) {
  const user = await getUser(ctx);
  const trial = user.trialEndsAt && user.trialEndsAt > new Date()
    ? `🎁 التجربة حتى ${user.trialEndsAt.toLocaleDateString('ar-IQ')}`
    : '🔓 التجربة غير مفعلة';
  return render(ctx, `🩺 QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية.\n\n${trial}\n💎 الخطة: ${user.plan}\n\nاختر القسم:`, mainMenu);
}

async function showSubjects(ctx: Context, prefix = 'subject') {
  const subjects = await db.subject.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] });
  if (!subjects.length) return render(ctx, 'لا توجد مواد مضافة حاليًا.', backMenu);
  return render(ctx, '📚 اختر المادة الدراسية:', subjectMenu(subjects, prefix));
}

async function showProgress(ctx: Context) {
  const user = await getUser(ctx);
  const [completed, attempts, correct] = await Promise.all([
    db.progress.count({ where: { userId: user.id, completed: true } }),
    db.attempt.count({ where: { userId: user.id } }),
    db.attempt.count({ where: { userId: user.id, correct: true } }),
  ]);
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
  return render(ctx, `📊 تقدمي\n\nالدروس المكتملة: ${completed}\nالمحاولات: ${attempts}\nالإجابات الصحيحة: ${correct}\nالدقة: ${accuracy}%`, backMenu);
}

async function showAccount(ctx: Context) {
  const user = await getUser(ctx);
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || '-';
  return render(ctx, `👤 حسابي\n\n🆔 Telegram ID: ${user.telegramId}\n👤 الاسم: ${name}\n🎯 القسم: ${user.department ?? 'غير محدد'}\n📚 المرحلة: ${user.stage ?? 'غير محددة'}\n💎 الخطة: ${user.plan}\n🎁 التجربة: ${user.trialUsed ? 'مستخدمة' : 'متاحة'}`, new InlineKeyboard().text('🎯 تغيير القسم/المرحلة', 'study_mode').row().text('🏠 الرئيسية', 'home'));
}

async function showQuestion(ctx: Context, key: string) {
  const session = sessions.get(key);
  if (!session || session.index >= session.ids.length) return finishQuiz(ctx, key);
  if (isQuizExpired(session, Date.now())) return finishQuiz(ctx, key, true);
  const question = await db.question.findUnique({ where: { id: session.ids[session.index] } });
  if (!question || !canUseInButtonQuiz(question)) return finishQuiz(ctx, key);
  const label = session.exam ? `🧠 الاختبار — سؤال ${session.index + 1}/${session.ids.length}` : `❓ تدريب — سؤال ${session.index + 1}/${session.ids.length}`;
  return replyLong(ctx, `${label}\n\n${question.text}`, answerKeyboard(question.type, question.options, question.id));
}

async function startQuiz(ctx: Context, subjectId: number, ministerial: boolean, exam: boolean) {
  const user = await getUser(ctx);
  if (!(await hasPremiumAccess(user.id))) return render(ctx, '🔒 هذا القسم يحتاج اشتراكًا أو تجربة مفعلة.', backMenu);
  const questions = await db.question.findMany({
    where: { subjectId, isMinisterial: ministerial, type: { in: ['MCQ', 'TRUE_FALSE'] } },
    select: { id: true },
  });
  if (!questions.length) return render(ctx, 'لا توجد أسئلة متاحة لهذه المادة حاليًا.', backMenu);
  const ids = questions.map(q => q.id).sort(() => Math.random() - 0.5).slice(0, 10);
  const key = userKey(ctx);
  sessions.set(key, { ids, index: 0, correct: 0, answered: 0, ministerial, exam, startedAt: Date.now() });
  await render(ctx, exam ? '🧠 بدأ الاختبار. لديك 15 دقيقة كحد أقصى.' : '❓ بدأ التدريب. أجب عن الأسئلة بالترتيب.');
  return showQuestion(ctx, key);
}

async function finishQuiz(ctx: Context, key: string, timedOut = false) {
  const session = sessions.get(key);
  sessions.delete(key);
  if (!session) return;
  const accuracy = session.answered ? Math.round((session.correct / session.answered) * 100) : 0;
  const unanswered = Math.max(session.ids.length - session.answered, 0);
  return ctx.reply(`${session.exam ? '🏁 انتهى الاختبار' : '🏁 انتهى التدريب'}${timedOut ? '\n⏰ انتهى الوقت.' : ''}\n\nالنتيجة: ${session.correct}/${session.answered}\nالدقة: ${accuracy}%${unanswered ? `\n⏳ غير مجاب: ${unanswered}` : ''}`, { reply_markup: backMenu });
}

bot.command('start', async ctx => {
  const user = await getUser(ctx);
  if (config.TRIAL_ENABLED && !user.trialUsed) await ensureTrial(user.id);
  await home(ctx);
});
bot.command('help', async ctx => ctx.reply('📖 أوامر QMRMed\n\n/start — الرئيسية\n/study — وضع الدراسة\n/search — البحث\n/ai — المساعد الذكي\n/questions — بنك الأسئلة\n/ministerial — الوزاريات\n/exams — الاختبارات\n/progress — تقدمي\n/plans — الاشتراك\n/trial — التجربة\n/account — حسابي\n/settings — الإعدادات\n/about — عن QMRMed\n/cancel — إلغاء\n/admin — الإدارة'));
bot.command('study', async ctx => ctx.reply('🎯 اختر القسم الدراسي:', { reply_markup: studyDepartmentMenu() }));
bot.command('search', async ctx => { pending.set(userKey(ctx), 'search'); await ctx.reply('🔎 أرسل كلمة أو عبارة للبحث داخل محتوى QMRMed المعتمد فقط.', { reply_markup: backMenu }); });
bot.command('ai', async ctx => { pending.set(userKey(ctx), 'ai'); await ctx.reply('🤖 أرسل سؤالك الطبي. سأبحث أولًا في محتوى QMRMed المعتمد ثم أجيب منه فقط.', { reply_markup: backMenu }); });
bot.command('questions', async ctx => showSubjects(ctx, 'qbsubject'));
bot.command('ministerial', async ctx => showSubjects(ctx, 'mqsubject'));
bot.command('exams', async ctx => showSubjects(ctx, 'examsubject'));
bot.command('progress', showProgress);
bot.command('plans', async ctx => ctx.reply('💎 اشتراكات QMRMed\n\n🆓 FREE — المحتوى الأساسي\n💙 PLUS — مزايا موسعة\n💜 PRO — الوصول الكامل\n\nالدفع الفعلي سيُربط عبر Telegram Stars قبل الإنتاج.', { reply_markup: new InlineKeyboard().text('💙 PLUS', 'plan:PLUS').text('💜 PRO', 'plan:PRO').row().text('⬅️ الرئيسية', 'home') }));
bot.command('trial', async ctx => {
  const user = await getUser(ctx);
  if (user.trialUsed) return ctx.reply('🎁 تم استخدام التجربة المجانية لهذا الحساب بالفعل.', { reply_markup: backMenu });
  const updated = await ensureTrial(user.id);
  return ctx.reply(`🎁 تم تفعيل التجربة المجانية.\nتنتهي في: ${updated.trialEndsAt?.toLocaleString('ar-IQ') ?? '-'}`, { reply_markup: backMenu });
});
bot.command('account', showAccount);
bot.command('settings', async ctx => ctx.reply('⚙️ الإعدادات\n\n🎯 استخدم /study لتحديد القسم والمرحلة.', { reply_markup: backMenu }));
bot.command('about', async ctx => ctx.reply('ℹ️ QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية تجمع المحتوى الدراسي وبنك الأسئلة والوزاريات والاختبارات والتقدم والمساعد الذكي.', { reply_markup: backMenu }));
bot.command('cancel', async ctx => { pending.delete(userKey(ctx)); sessions.delete(userKey(ctx)); await ctx.reply('❌ تم إلغاء العملية الحالية.', { reply_markup: mainMenu }); });

bot.callbackQuery('home', async ctx => { await ctx.answerCallbackQuery(); pending.delete(userKey(ctx)); sessions.delete(userKey(ctx)); await home(ctx); });
bot.callbackQuery('subjects', async ctx => { await ctx.answerCallbackQuery(); await showSubjects(ctx); });
bot.callbackQuery(/^subject:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const subject = await db.subject.findUnique({ where: { id: Number(ctx.match[1]) }, include: { topics: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } });
  if (!subject) return render(ctx, 'المادة غير موجودة.', backMenu);
  return render(ctx, `📖 ${subject.name}\n\n${subject.description ?? 'اختر الموضوع:'}`, topicMenu(subject.topics, subject.id));
});
bot.callbackQuery(/^topic:(\d+):(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const topic = await db.topic.findUnique({ where: { id: Number(ctx.match[1]) }, include: { lessons: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } });
  if (!topic) return render(ctx, 'الموضوع غير موجود.', backMenu);
  return render(ctx, `📘 ${topic.name}\n\nاختر الدرس:`, lessonMenu(topic.lessons, topic.id, Number(ctx.match[2])));
});
bot.callbackQuery(/^topicback:(\d+):(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const subject = await db.subject.findUnique({ where: { id: Number(ctx.match[2]) }, include: { topics: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } });
  if (!subject) return render(ctx, 'المادة غير موجودة.', backMenu);
  return render(ctx, `📖 ${subject.name}\n\nاختر الموضوع:`, topicMenu(subject.topics, subject.id));
});
bot.callbackQuery(/^lesson:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const lesson = await db.lesson.findUnique({ where: { id: Number(ctx.match[1]) }, include: { topic: true } });
  if (!lesson) return render(ctx, 'الدرس غير موجود.', backMenu);
  const user = await getUser(ctx);
  const progress = await db.progress.upsert({ where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } }, create: { userId: user.id, lessonId: lesson.id, completed: false }, update: {} });
  const keyboard = new InlineKeyboard().text(progress.completed ? '✅ مكتمل' : '☑️ تعليم كمكتمل', `complete:${lesson.id}`).row().text('⬅️ الموضوع', `topicback:${lesson.topicId}:${lesson.topic.subjectId}`).row().text('🏠 الرئيسية', 'home');
  return replyLong(ctx, `📖 ${lesson.title}\n\n${lesson.content}\n\n${lesson.source ? `📚 المصدر: ${lesson.source}` : ''}`, keyboard);
});
bot.callbackQuery(/^complete:(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery('تم حفظ التقدم');
  const user = await getUser(ctx);
  await db.progress.upsert({ where: { userId_lessonId: { userId: user.id, lessonId: Number(ctx.match[1]) } }, create: { userId: user.id, lessonId: Number(ctx.match[1]), completed: true }, update: { completed: true } });
  return ctx.editMessageReplyMarkup({ reply_markup: backMenu });
});

bot.callbackQuery('question_bank', async ctx => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'qbsubject'); });
bot.callbackQuery('ministerial', async ctx => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'mqsubject'); });
bot.callbackQuery(/^qbsubject:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), false, false); });
bot.callbackQuery(/^mqsubject:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), true, false); });
bot.callbackQuery('exams', async ctx => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'examsubject'); });
bot.callbackQuery(/^examsubject:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), false, true); });
bot.callbackQuery(/^ans:(\d+):(.+)$/, async ctx => {
  await ctx.answerCallbackQuery();
  const key = userKey(ctx);
  const session = sessions.get(key);
  if (!session) return ctx.reply('انتهت الجلسة. ابدأ تدريبًا جديدًا من القائمة.');
  if (isQuizExpired(session, Date.now())) return finishQuiz(ctx, key, true);
  const questionId = Number(ctx.match[1]);
  if (session.ids[session.index] !== questionId) return ctx.reply('⚠️ هذا السؤال لم يعد فعالًا. استخدم آخر سؤال ظاهر.');
  const question = await db.question.findUnique({ where: { id: questionId } });
  if (!question || !canUseInButtonQuiz(question)) return ctx.reply('⚠️ تعذر معالجة هذا السؤال.');
  const selected = ctx.match[2];
  const selectedValue = resolveSelectedValue(question, selected);
  const correct = isAnswerCorrect(question, selected);
  const user = await getUser(ctx);
  if (correct) session.correct++;
  session.answered++;
  session.index++;
  await db.attempt.create({ data: { userId: user.id, questionId: question.id, answer: selectedValue, correct } });
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(correct ? '✅ صحيح' : `❌ خطأ — الصحيح: ${question.answer}`, 'quiz:noop') });
  if (session.index >= session.ids.length) return finishQuiz(ctx, key);
  return showQuestion(ctx, key);
});
bot.callbackQuery('quiz:stop', async ctx => { await ctx.answerCallbackQuery(); await finishQuiz(ctx, userKey(ctx)); });
bot.callbackQuery('quiz:noop', async ctx => ctx.answerCallbackQuery());
bot.callbackQuery('progress', async ctx => { await ctx.answerCallbackQuery(); await showProgress(ctx); });
bot.callbackQuery('study_mode', async ctx => { await ctx.answerCallbackQuery(); await render(ctx, '🎯 اختر القسم الدراسي:', studyDepartmentMenu()); });
bot.callbackQuery(/^study:department:(Medicine|Dentistry|Pharmacy)$/, async ctx => { await ctx.answerCallbackQuery(); await render(ctx, `🎯 ${ctx.match[1]}\n\nاختر المرحلة:`, studyStageMenu(ctx.match[1])); });
bot.callbackQuery(/^study:stage:(Medicine|Dentistry|Pharmacy):(\d+)$/, async ctx => {
  await ctx.answerCallbackQuery('تم حفظ التفضيل');
  const user = await getUser(ctx);
  await db.user.update({ where: { id: user.id }, data: { department: ctx.match[1], stage: ctx.match[2] } });
  return render(ctx, `✅ تم حفظ وضع الدراسة\n\nالقسم: ${ctx.match[1]}\nالمرحلة: ${ctx.match[2]}`, new InlineKeyboard().text('📚 الدراسة', 'subjects').row().text('🏠 الرئيسية', 'home'));
});
bot.callbackQuery('search', async ctx => { await ctx.answerCallbackQuery(); pending.set(userKey(ctx), 'search'); await render(ctx, '🔎 أرسل كلمة أو عبارة للبحث داخل محتوى QMRMed المعتمد فقط.', new InlineKeyboard().text('❌ إلغاء', 'home')); });
bot.callbackQuery('ai', async ctx => { await ctx.answerCallbackQuery(); pending.set(userKey(ctx), 'ai'); await render(ctx, '🤖 أرسل سؤالك الطبي. سأبحث أولًا في محتوى QMRMed المعتمد ثم أجيب منه فقط.', new InlineKeyboard().text('❌ إلغاء', 'home')); });
bot.callbackQuery('trial', async ctx => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx);
  if (user.trialUsed) return render(ctx, '🎁 تم استخدام التجربة المجانية لهذا الحساب بالفعل.', backMenu);
  const updated = await ensureTrial(user.id);
  return render(ctx, `🎁 تم تفعيل التجربة المجانية.\nتنتهي في: ${updated.trialEndsAt?.toLocaleString('ar-IQ') ?? '-'}`, backMenu);
});
bot.callbackQuery('plans', async ctx => { await ctx.answerCallbackQuery(); await render(ctx, '💎 اشتراكات QMRMed\n\n🆓 FREE — المحتوى الأساسي\n💙 PLUS — مزايا موسعة\n💜 PRO — الوصول الكامل\n\nالدفع الفعلي سيُربط قبل الإنتاج.', new InlineKeyboard().text('💙 PLUS', 'plan:PLUS').text('💜 PRO', 'plan:PRO').row().text('⬅️ الرئيسية', 'home')); });
bot.callbackQuery(/^plan:(PLUS|PRO)$/, async ctx => { await ctx.answerCallbackQuery(); await render(ctx, `💎 ${ctx.match[1]}\n\nهذه الواجهة لا تعتبر ضغط الزر دفعًا. سيتم تفعيل الخطة فقط بعد التحقق من عملية الدفع.`, backMenu); });
bot.callbackQuery('account', async ctx => { await ctx.answerCallbackQuery(); await showAccount(ctx); });
bot.callbackQuery('settings', async ctx => { await ctx.answerCallbackQuery(); await render(ctx, '⚙️ الإعدادات\n\n🎯 استخدم «وضع الدراسة» لتحديد القسم والمرحلة.', backMenu); });
bot.callbackQuery('about', async ctx => { await ctx.answerCallbackQuery(); await render(ctx, 'ℹ️ QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية.', backMenu); });

function adminGuard(ctx: Context) {
  return isAdmin(ctx.from?.id ?? '');
}

async function adminAction(ctx: Context, data: string) {
  if (data === 'admin:stats') {
    const d = await getAdminDashboard();
    return render(ctx, `📊 Dashboard QMRMed\n\n👥 المستخدمون: ${d.users}\n🆓 FREE: ${d.free}\n💙 PLUS: ${d.plus}\n💜 PRO: ${d.pro}\n\n📚 المواد: ${d.subjects}\n📘 المواضيع: ${d.topics}\n📖 الدروس: ${d.lessons}\n❓ الأسئلة: ${d.questions}\n📝 الوزاريات: ${d.ministerialQuestions}\n🎯 المحاولات: ${d.attempts}\n\n☁️ المصادر المعتمدة: ${d.approvedSources}\n🔎 المفهرسة: ${d.indexedSources}\n🧩 المقاطع: ${d.chunks}`, adminMenu());
  }
  if (data === 'admin:users') {
    const d = await getAdminDashboard();
    return render(ctx, `👥 المستخدمون\n\nإجمالي: ${d.users}\nFREE: ${d.free}\nPLUS: ${d.plus}\nPRO: ${d.pro}`, adminMenu());
  }
  if (data === 'admin:content') {
    const d = await getAdminDashboard();
    const breakdown = await getContentBreakdown();
    return render(ctx, `📚 المحتوى\n\n${breakdown.map(item => `${item.kind}: ${item.count}`).join('\n')}\n\nالمواد: ${d.subjects}\nالمواضيع: ${d.topics}\nالدروس: ${d.lessons}\nالأسئلة: ${d.questions}\nالوزاريات: ${d.ministerialQuestions}\nالمصادر المعتمدة: ${d.approvedSources}\nالمفهرسة: ${d.indexedSources}\nالمقاطع: ${d.chunks}`, adminMenu());
  }
  if (data === 'admin:questions') {
    const d = await getAdminDashboard();
    return render(ctx, `📝 الأسئلة والوزاريات\n\n❓ بنك الأسئلة: ${d.questions}\n📝 الوزاريات: ${d.ministerialQuestions}\n🎯 المحاولات: ${d.attempts}`, adminMenu());
  }
  if (data === 'admin:drive' || data === 'admin:drive:status') {
    const status = await getDriveStatus();
    const state = status.state;
    return render(ctx, `☁️ Google Drive\n\nالحالة: ${status.configured ? 'مُهيأ' : 'غير مُهيأ'}\nRoot: ${status.rootFolderId ?? '-'}\nآخر تشغيل: ${state?.lastRunAt?.toLocaleString('ar-IQ') ?? '-'}\nآخر نجاح: ${state?.lastSuccessAt?.toLocaleString('ar-IQ') ?? '-'}\nالملفات: ${state?.filesSeen ?? 0}\nالمفهرسة: ${state?.filesIndexed ?? 0}\n${state?.lastError ? `❌ ${state.lastError}` : '✅ لا يوجد خطأ مسجل'}`, adminDriveMenu());
  }
  if (data === 'admin:drive:sync') {
    const status = await getDriveStatus();
    if (!status.configured) return render(ctx, '❌ Google Drive غير مُهيأ.', adminDriveMenu());
    await render(ctx, '🔄 جاري مزامنة Google Drive…');
    const result = await runAdminDriveSync();
    return render(ctx, `✅ اكتملت المزامنة\n\n📄 الملفات: ${result.filesSeen}\n🔎 المفهرسة: ${result.filesIndexed}\n⏭️ المتخطاة: ${result.filesSkipped}\n🗑️ المحذوف فهرسها: ${result.filesRemoved}\n🧩 المقاطع: ${result.chunks}`, adminDriveMenu());
  }
  if (data === 'admin:ai') {
    const summary = aiRoutingSummary();
    const result = await routedChat('admin', 'PRO', [{ role: 'user', content: 'Reply only: QMRMed OmniRoute OK' }], 0);
    return render(ctx, `🤖 OmniRoute\n\n${result}\n\n🔗 ${summary.url}\n⚙️ default=${summary.defaultModel}`, adminMenu());
  }
  if (data === 'admin:broadcast') {
    pending.set(userKey(ctx), 'broadcast');
    return render(ctx, '📣 أرسل رسالة الإرسال الجماعي الآن.', backMenu);
  }
  return render(ctx, '🛠️ لوحة الإدارة', adminMenu());
}

bot.callbackQuery(/^admin(?::.*)?$/, async ctx => {
  await ctx.answerCallbackQuery();
  if (!adminGuard(ctx)) return render(ctx, 'غير مصرح.');
  const data = ctx.callbackQuery.data;
  try {
    return await adminAction(ctx, data);
  } catch (error) {
    console.error('Admin action failed:', error);
    const markup = data.startsWith('admin:drive') ? adminDriveMenu() : adminMenu();
    return render(ctx, `❌ تعذر التنفيذ.\n\n${error instanceof Error ? error.message : String(error)}`, markup);
  }
});

bot.callbackQuery('admin', async ctx => {
  await ctx.answerCallbackQuery();
  if (!adminGuard(ctx)) return render(ctx, 'غير مصرح.');
  return render(ctx, '🛠️ لوحة الإدارة', adminMenu());
});

bot.command('admin', async ctx => {
  if (!adminGuard(ctx)) return ctx.reply('غير مصرح.');
  return ctx.reply('🛠️ لوحة الإدارة', { reply_markup: adminMenu() });
});

bot.on('message:text', async ctx => {
  const key = userKey(ctx);
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  const user = await getUser(ctx);
  const action = pending.get(key);
  if (!action) return ctx.reply('استخدم /start لفتح لوحة QMRMed.', { reply_markup: mainMenu });
  pending.delete(key);

  if (action === 'broadcast') {
    if (!isAdmin(ctx.from.id)) return ctx.reply('غير مصرح.');
    const users = await db.user.findMany({ select: { telegramId: true } });
    let sent = 0;
    for (const target of users) {
      try { await ctx.api.sendMessage(target.telegramId, `📣 QMRMed\n\n${text}`); sent++; }
      catch (error) { console.warn('Broadcast delivery failed:', target.telegramId, error); }
    }
    return ctx.reply(`✅ اكتمل الإرسال. نجح: ${sent}/${users.length}`);
  }

  if (action === 'search') {
    try {
      const results = await searchApprovedContent(text, { take: 10, department: user.department ?? undefined, stage: user.stage ?? undefined });
      if (!results.length) return ctx.reply('لم أجد نتيجة مطابقة داخل محتوى QMRMed المعتمد ضمن إعدادات الدراسة الحالية.');
      return replyLong(ctx, `🔎 نتائج البحث داخل QMRMed المعتمد:\n\n${formatRetrievedContext(results, 10_000)}`);
    } catch (error) {
      console.error('Search failed:', error);
      return ctx.reply('⚠️ تعذر البحث حاليًا. تأكد من مزامنة المحتوى وقاعدة البيانات ثم حاول مرة أخرى.');
    }
  }

  try {
    const response = await answerMedicalQuestion(text, { department: user.department ?? undefined, stage: user.stage ?? undefined });
    return replyLong(ctx, `🤖 QMRMed AI\n\n${response}`);
  } catch (error) {
    console.error('AI failed:', error);
    return ctx.reply('⚠️ تعذر الوصول إلى المساعد الذكي حاليًا. تأكد من إعداد OmniRoute وقاعدة البيانات.');
  }
});

bot.catch(error => console.error('QMRMed Bot error:', error.error));
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

bot.start({
  onStart: async info => {
    console.log(`QMRMed Bot started: @${info.username}`);
    await bot.api.setMyCommands([
      { command: 'start', description: 'فتح QMRMed' },
      { command: 'help', description: 'المساعدة والأوامر' },
      { command: 'study', description: 'القسم والمرحلة' },
      { command: 'search', description: 'البحث في محتوى QMRMed' },
      { command: 'ai', description: 'المساعد الذكي' },
      { command: 'questions', description: 'بنك الأسئلة' },
      { command: 'ministerial', description: 'الأسئلة الوزارية' },
      { command: 'exams', description: 'الاختبارات' },
      { command: 'progress', description: 'التقدم والنتائج' },
      { command: 'plans', description: 'الاشتراكات' },
      { command: 'trial', description: 'التجربة المجانية' },
      { command: 'account', description: 'حسابي' },
      { command: 'settings', description: 'الإعدادات' },
      { command: 'about', description: 'عن QMRMed' },
      { command: 'cancel', description: 'إلغاء العملية الحالية' },
      { command: 'admin', description: 'لوحة الإدارة' },
    ]);
  },
});
