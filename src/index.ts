import { Bot, Context, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { db, upsertTelegramUser } from './db.js';
import { answerMedicalQuestion, omniChat } from './ai.js';
import { backMenu, mainMenu, subjectMenu, topicMenu, lessonMenu, adminMenu } from './menu.js';
import { ensureTrial, hasPremiumAccess, isAdmin } from './access.js';

const bot = new Bot(config.BOT_TOKEN);
type PendingAction = 'search' | 'ai' | 'broadcast';
const pending = new Map<string, PendingAction>();

type QuizSession = { ids: number[]; index: number; correct: number; ministerial: boolean; exam: boolean; startedAt: number };
const sessions = new Map<string, QuizSession>();

async function getUser(ctx: Context) {
  if (!ctx.from) throw new Error('Missing Telegram user');
  return upsertTelegramUser(ctx.from);
}

function userKey(ctx: Context) { return String(ctx.from?.id ?? ''); }

function answerKeyboard(options: unknown, qid: number) {
  const keyboard = new InlineKeyboard();
  if (Array.isArray(options)) {
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
  const trial = user.trialEndsAt && user.trialEndsAt > new Date() ? `🎁 التجربة حتى ${user.trialEndsAt.toLocaleDateString('ar-IQ')}` : '🔓 التجربة غير مفعلة';
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
  if (session.exam && Date.now() - session.startedAt > 15 * 60_000) return finishQuiz(ctx, key, true);
  const question = await db.question.findUnique({ where: { id: session.ids[session.index] } });
  if (!question) return finishQuiz(ctx, key);
  const label = session.exam ? `🧠 الاختبار — سؤال ${session.index + 1}/${session.ids.length}` : `❓ تدريب — سؤال ${session.index + 1}/${session.ids.length}`;
  await ctx.reply(`${label}\n\n${question.text}`, { reply_markup: answerKeyboard(question.options, question.id) });
}

async function startQuiz(ctx: Context, subjectId: number, ministerial: boolean, exam: boolean) {
  const user = await getUser(ctx);
  if (!(await hasPremiumAccess(user.id))) return ctx.editMessageText('🔒 هذا القسم يحتاج اشتراكًا أو تجربة مفعلة.', { reply_markup: backMenu });
  const questions = await db.question.findMany({ where: { subjectId, isMinisterial: ministerial }, select: { id: true }, take: 10 });
  if (!questions.length) return ctx.editMessageText('لا توجد أسئلة متاحة لهذه المادة حاليًا.', { reply_markup: backMenu });
  const ids = questions.sort(() => Math.random() - 0.5).map((q) => q.id);
  const key = userKey(ctx);
  sessions.set(key, { ids, index: 0, correct: 0, ministerial, exam, startedAt: Date.now() });
  await ctx.editMessageText(exam ? '🧠 بدأ الاختبار. لديك 15 دقيقة كحد أقصى.' : '❓ بدأ التدريب. أجب عن الأسئلة بالترتيب.');
  await showQuestion(ctx, key);
}

async function finishQuiz(ctx: Context, key: string, timedOut = false) {
  const session = sessions.get(key);
  sessions.delete(key);
  if (!session) return;
  const total = session.ids.length;
  const accuracy = total ? Math.round((session.correct / total) * 100) : 0;
  await ctx.reply(`${session.exam ? '🏁 انتهى الاختبار' : '🏁 انتهى التدريب'}${timedOut ? '\n⏰ انتهى الوقت.' : ''}\n\nالنتيجة: ${session.correct}/${total}\nالدقة: ${accuracy}%`, { reply_markup: backMenu });
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
  const subjectId = Number(ctx.match[1]);
  const subject = await db.subject.findUnique({ where: { id: subjectId }, include: { topics: { orderBy: { order: 'asc' } } } });
  if (!subject) return ctx.editMessageText('المادة غير موجودة.', { reply_markup: backMenu });
  await ctx.editMessageText(`📖 ${subject.name}\n\n${subject.description ?? 'اختر الموضوع:'}`, { reply_markup: topicMenu(subject.topics, subject.id) });
});
bot.callbackQuery(/^topic:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const topicId = Number(ctx.match[1]); const subjectId = Number(ctx.match[2]);
  const topic = await db.topic.findUnique({ where: { id: topicId }, include: { lessons: { orderBy: { order: 'asc' } } } });
  if (!topic) return ctx.editMessageText('الموضوع غير موجود.', { reply_markup: backMenu });
  await ctx.editMessageText(`📘 ${topic.name}\n\nاختر الدرس:`, { reply_markup: lessonMenu(topic.lessons, topic.id, subjectId) });
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
  await ctx.editMessageText(`📖 ${lesson.title}\n\n${lesson.content}\n\n${lesson.source ? `📚 المصدر: ${lesson.source}` : ''}`, { reply_markup: keyboard });
});
bot.callbackQuery(/^complete:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery('تم حفظ التقدم'); const user = await getUser(ctx); await db.progress.upsert({ where: { userId_lessonId: { userId: user.id, lessonId: Number(ctx.match[1]) } }, create: { userId: user.id, lessonId: Number(ctx.match[1]), completed: true }, update: { completed: true } }); await ctx.editMessageReplyMarkup({ reply_markup: backMenu }); });

bot.callbackQuery('question_bank', async (ctx) => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'qbsubject'); });
bot.callbackQuery('ministerial', async (ctx) => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'mqsubject'); });
bot.callbackQuery(/^qbsubject:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), false, false); });
bot.callbackQuery(/^mqsubject:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), true, false); });
bot.callbackQuery('exams', async (ctx) => { await ctx.answerCallbackQuery(); await showSubjects(ctx, 'examsubject'); });
bot.callbackQuery(/^examsubject:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), false, true); });
bot.callbackQuery(/^ans:(\d+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const key = userKey(ctx); const session = sessions.get(key); if (!session) return ctx.reply('انتهت الجلسة. ابدأ تدريبًا جديدًا من القائمة.');
  const question = await db.question.findUnique({ where: { id: Number(ctx.match[1]) } }); if (!question) return;
  const selected = ctx.match[2]; const opts = question.options;
  let selectedValue = selected;
  if (Array.isArray(opts) && /^\d+$/.test(selected)) selectedValue = String(opts[Number(selected)] ?? selected);
  if (opts && typeof opts === 'object' && !Array.isArray(opts)) selectedValue = String((opts as Record<string, unknown>)[selected] ?? selected);
  const correct = String(selectedValue).trim().toLowerCase() === String(question.answer).trim().toLowerCase();
  if (correct) session.correct++;
  const user = await getUser(ctx);
  await db.attempt.create({ data: { userId: user.id, questionId: question.id, answer: selectedValue, correct } });
  session.index++;
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(correct ? '✅ صحيح' : `❌ خطأ — الصحيح: ${question.answer}`, 'quiz:noop') });
  if (session.index >= session.ids.length) return finishQuiz(ctx, key);
  await showQuestion(ctx, key);
});
bot.callbackQuery('quiz:stop', async (ctx) => { await ctx.answerCallbackQuery(); await finishQuiz(ctx, userKey(ctx)); });
bot.callbackQuery('quiz:noop', async (ctx) => ctx.answerCallbackQuery());

bot.callbackQuery('progress', async (ctx) => {
  await ctx.answerCallbackQuery(); const user = await getUser(ctx);
  const [completed, attempts, correct] = await Promise.all([db.progress.count({ where: { userId: user.id, completed: true } }), db.attempt.count({ where: { userId: user.id } }), db.attempt.count({ where: { userId: user.id, correct: true } })]);
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
  await ctx.editMessageText(`📊 تقدمي ونتائجي\n\n📖 الدروس المكتملة: ${completed}\n❓ المحاولات: ${attempts}\n✅ الصحيحة: ${correct}\n🎯 الدقة: ${accuracy}%`, { reply_markup: backMenu });
});

bot.callbackQuery('study_mode', async (ctx) => {
  await ctx.answerCallbackQuery(); const user = await getUser(ctx);
  const keyboard = new InlineKeyboard().text('1️⃣ المرحلة الأولى', 'stage:1').text('2️⃣ الثانية', 'stage:2').row().text('3️⃣ الثالثة', 'stage:3').text('4️⃣ الرابعة', 'stage:4').row().text('5️⃣ الخامسة', 'stage:5').text('6️⃣ السادسة', 'stage:6').row().text('🏥 طب عام', 'dept:medicine').text('💊 صيدلة', 'dept:pharmacy').row().text('🦷 طب أسنان', 'dept:dentistry').text('⬅️ الرئيسية', 'home');
  await ctx.editMessageText(`🎯 إعداد الدراسة\n\nالمرحلة الحالية: ${user.stage ?? 'غير محددة'}\nالقسم: ${user.department ?? 'غير محدد'}\n\nاختر ما تريد تغييره:`, { reply_markup: keyboard });
});
bot.callbackQuery(/^stage:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery('تم الحفظ'); const user = await getUser(ctx); await db.user.update({ where: { id: user.id }, data: { stage: ctx.match[1] } }); await ctx.editMessageText('✅ تم حفظ المرحلة.', { reply_markup: backMenu }); });
bot.callbackQuery(/^dept:(.+)$/, async (ctx) => { await ctx.answerCallbackQuery('تم الحفظ'); const user = await getUser(ctx); const names: Record<string, string> = { medicine: 'طب عام', pharmacy: 'صيدلة', dentistry: 'طب أسنان' }; await db.user.update({ where: { id: user.id }, data: { department: names[ctx.match[1]] ?? ctx.match[1] } }); await ctx.editMessageText(`✅ تم حفظ القسم: ${names[ctx.match[1]] ?? ctx.match[1]}`, { reply_markup: backMenu }); });

bot.callbackQuery('search', async (ctx) => { await ctx.answerCallbackQuery(); pending.set(userKey(ctx), 'search'); await ctx.editMessageText('🔎 أرسل كلمة أو موضوعًا. سأبحث داخل محتوى QMRMed المخزن فقط.', { reply_markup: backMenu }); });
bot.callbackQuery('ai', async (ctx) => { await ctx.answerCallbackQuery(); pending.set(userKey(ctx), 'ai'); await ctx.editMessageText('🤖 أرسل سؤالك الطبي أو الدراسي. سيُعالج عبر OmniRoute، مع تزويده بسياق QMRMed المتاح فقط.', { reply_markup: backMenu }); });

bot.callbackQuery('account', async (ctx) => { await ctx.answerCallbackQuery(); const user = await getUser(ctx); await ctx.editMessageText(`👤 حسابي\n\nالاسم: ${user.firstName ?? '-'}\nالمستخدم: @${user.username ?? '-'}\nالخطة: ${user.plan}\nالمرحلة: ${user.stage ?? '-'}\nالقسم: ${user.department ?? '-'}\nالتجربة: ${user.trialEndsAt && user.trialEndsAt > new Date() ? `حتى ${user.trialEndsAt.toLocaleDateString('ar-IQ')}` : 'غير مفعلة'}`, { reply_markup: backMenu }); });
bot.callbackQuery('trial', async (ctx) => { await ctx.answerCallbackQuery(); const user = await getUser(ctx); if (user.trialUsed) return ctx.editMessageText('🎁 تم استخدام التجربة المجانية لهذا الحساب بالفعل.', { reply_markup: backMenu }); const updated = await ensureTrial(user.id); await ctx.editMessageText(`🎁 تم تفعيل التجربة المجانية.\nتنتهي في: ${updated.trialEndsAt?.toLocaleString('ar-IQ') ?? '-'}`, { reply_markup: backMenu }); });
bot.callbackQuery('plans', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('💎 اشتراكات QMRMed\n\n🆓 FREE — المحتوى الأساسي\n💙 PLUS — مزايا دراسية موسعة\n💜 PRO — الوصول الكامل\n\nسيتم ربط الدفع الفعلي عبر Telegram Stars قبل الإنتاج. لا يتم اعتبار الضغط على الزر عملية دفع.', { reply_markup: new InlineKeyboard().text('💙 PLUS', 'plan:PLUS').text('💜 PRO', 'plan:PRO').row().text('⬅️ الرئيسية', 'home') }); });
bot.callbackQuery(/^plan:(PLUS|PRO)$/, async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText(`💎 ${ctx.match[1]}\n\nهذه الواجهة جاهزة لربط Telegram Stars/بوابة الدفع. لن يتم تفعيل الاشتراك إلا بعد وصول تأكيد الدفع والتحقق منه.`, { reply_markup: backMenu }); });
bot.callbackQuery('settings', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('⚙️ الإعدادات\n\n🎯 المرحلة والقسم من «وضع الدراسة».\n🔔 الإشعارات والتذكيرات ستضاف مع طبقة الإشعارات.\n🌐 لغة الواجهة محفوظة كقابلية توسعة.', { reply_markup: backMenu }); });
bot.callbackQuery('about', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('ℹ️ QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية، تجمع المحتوى الدراسي، بنك الأسئلة، الوزاريات، الاختبارات، التقدم والمساعد الذكي في تجربة واحدة.', { reply_markup: backMenu }); });

bot.callbackQuery(/^admin(?::.*)?$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!isAdmin(ctx.from?.id ?? '')) return ctx.editMessageText('غير مصرح.'); const data = ctx.callbackQuery.data; if (data === 'admin:stats') { const [users, subjects, lessons, questions, attempts] = await Promise.all([db.user.count(), db.subject.count(), db.lesson.count(), db.question.count(), db.attempt.count()]); return ctx.editMessageText(`🛠️ الإحصائيات\n\n👥 المستخدمون: ${users}\n📚 المواد: ${subjects}\n📖 الدروس: ${lessons}\n❓ الأسئلة: ${questions}\n📝 المحاولات: ${attempts}`, { reply_markup: adminMenu() }); } if (data === 'admin:users') { const [free, plus, pro] = await Promise.all([db.user.count({ where: { plan: 'FREE' } }), db.user.count({ where: { plan: 'PLUS' } }), db.user.count({ where: { plan: 'PRO' } })]); return ctx.editMessageText(`👥 المستخدمون\n\nFREE: ${free}\nPLUS: ${plus}\nPRO: ${pro}`, { reply_markup: adminMenu() }); } if (data === 'admin:content') { const [subjects, topics, lessons, questions] = await Promise.all([db.subject.count(), db.topic.count(), db.lesson.count(), db.question.count()]); return ctx.editMessageText(`📚 المحتوى\n\nالمواد: ${subjects}\nالمواضيع: ${topics}\nالدروس: ${lessons}\nالأسئلة: ${questions}`, { reply_markup: adminMenu() }); } if (data === 'admin:broadcast') { pending.set(userKey(ctx), 'broadcast'); return ctx.editMessageText('📣 أرسل الآن رسالة الإرسال الجماعي. سيتم إرسالها للمستخدمين المسجلين.', { reply_markup: backMenu }); } if (data === 'admin:ai') { try { const result = await omniChat([{ role: 'user', content: 'Reply only: QMRMed OmniRoute OK' }], { temperature: 0 }); return ctx.editMessageText(`🤖 OmniRoute يعمل.\n\n${result}`, { reply_markup: adminMenu() }); } catch (error) { return ctx.editMessageText(`❌ فشل فحص OmniRoute: ${error instanceof Error ? error.message : String(error)}`, { reply_markup: adminMenu() }); } } return ctx.editMessageText('🛠️ لوحة الإدارة', { reply_markup: adminMenu() }); });
bot.callbackQuery('admin', async (ctx) => { await ctx.answerCallbackQuery(); if (!isAdmin(ctx.from?.id ?? '')) return; await ctx.editMessageText('🛠️ لوحة الإدارة', { reply_markup: adminMenu() }); });

bot.command('admin', async (ctx) => { if (!isAdmin(ctx.from?.id ?? '')) return ctx.reply('غير مصرح.'); await ctx.reply('🛠️ لوحة الإدارة', { reply_markup: adminMenu() }); });

bot.on('message:text', async (ctx) => {
  const user = await getUser(ctx); const key = userKey(ctx); const text = ctx.message.text.trim(); if (text.startsWith('/')) return;
  const action = pending.get(key); if (!action) return ctx.reply('استخدم /start لفتح لوحة QMRMed.', { reply_markup: mainMenu });
  pending.delete(key);
  if (action === 'broadcast') {
    if (!isAdmin(ctx.from.id)) return ctx.reply('غير مصرح.');
    const users = await db.user.findMany({ select: { telegramId: true } }); let sent = 0;
    for (const target of users) { try { await ctx.api.sendMessage(target.telegramId, `📣 QMRMed\n\n${text}`); sent++; } catch { /* user may have blocked the bot */ } }
    return ctx.reply(`✅ اكتمل الإرسال. نجح: ${sent}/${users.length}`);
  }
  if (action === 'search') {
    const terms = text.split(/\s+/).filter(Boolean).slice(0, 8);
    const subjects = await db.subject.findMany({ where: { OR: terms.map((term) => ({ name: { contains: term } })) }, take: 10 });
    const lessons = await db.lesson.findMany({ where: { OR: terms.map((term) => ({ OR: [{ title: { contains: term } }, { content: { contains: term } }] })) }, include: { topic: { include: { subject: true } } }, take: 10 });
    const lines = [...subjects.map((s) => `📚 ${s.name}`), ...lessons.map((l) => `📖 ${l.title} — ${l.topic.subject.name}`)];
    return ctx.reply(lines.length ? `🔎 نتائج البحث داخل QMRMed:\n\n${lines.join('\n')}` : 'لم أجد نتيجة مطابقة داخل محتوى QMRMed.');
  }
  try {
    const contextLessons = await db.lesson.findMany({ where: { content: { contains: text.split(/\s+/)[0] ?? text } }, take: 5, select: { title: true, content: true, source: true } });
    const context = contextLessons.map((l) => `${l.title}\n${l.content}\nالمصدر: ${l.source ?? 'QMRMed'}`).join('\n\n');
    const response = await answerMedicalQuestion(text, context);
    return ctx.reply(`🤖 QMRMed AI\n\n${response}`);
  } catch (error) {
    console.error(error); return ctx.reply('⚠️ تعذر الوصول إلى المساعد الذكي حاليًا. تأكد من إعداد OmniRoute ثم حاول مرة أخرى.');
  }
});

bot.catch((err) => console.error('QMRMed Bot error:', err.error));
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
bot.start({ onStart: (info) => console.log(`@${info.username} is running`) });
