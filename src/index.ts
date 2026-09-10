import { Bot, Context, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { db, upsertTelegramUser } from './db.js';
import { answerMedicalQuestion, omniChat } from './ai.js';
import { formatRetrievedContext, searchApprovedContent } from './content-search.js';
import { backMenu, mainMenu, subjectMenu, topicMenu, lessonMenu, adminMenu, adminDriveMenu, studyDepartmentMenu, studyStageMenu } from './menu.js';
import { ensureTrial, hasPremiumAccess, isAdmin } from './access.js';
import { canUseInButtonQuiz, isAnswerCorrect, isQuizExpired, resolveSelectedValue } from './quiz.js';
import { getAdminDashboard, getDriveStatus, runAdminDriveSync, getContentBreakdown } from './admin-panel.js';

const bot = new Bot(config.BOT_TOKEN);
type PendingAction = 'search' | 'ai' | 'broadcast';
const pending = new Map<string, PendingAction>();
type QuizSession = { ids: number[]; index: number; correct: number; answered: number; ministerial: boolean; exam: boolean; startedAt: number };
const sessions = new Map<string, QuizSession>();
const TELEGRAM_TEXT_LIMIT = 3900;

function key(ctx: Context) { return `${ctx.chat?.id ?? 'private'}:${ctx.from?.id ?? ''}`; }
async function user(ctx: Context) { if (!ctx.from) throw new Error('Missing Telegram user'); return upsertTelegramUser(ctx.from); }
function splitText(text: string, limit = TELEGRAM_TEXT_LIMIT) {
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = Math.max(rest.lastIndexOf('\n', limit), rest.lastIndexOf(' ', limit));
    if (cut < limit * 0.6) cut = limit;
    out.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out.length ? out : [''];
}
async function replyLong(ctx: Context, text: string, markup?: InlineKeyboard) {
  const parts = splitText(text);
  for (let i = 0; i < parts.length; i++) await ctx.reply(parts[i], i === parts.length - 1 && markup ? { reply_markup: markup } : undefined);
}
async function render(ctx: Context, text: string, markup?: InlineKeyboard) {
  if (ctx.callbackQuery?.message) return ctx.editMessageText(text, markup ? { reply_markup: markup } : undefined);
  return ctx.reply(text, markup ? { reply_markup: markup } : undefined);
}
function answerKeyboard(type: 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER', options: unknown, qid: number) {
  const k = new InlineKeyboard();
  if (type === 'TRUE_FALSE') { k.text('✅ صحيح', `ans:${qid}:صحيح`).row(); k.text('❌ خطأ', `ans:${qid}:خطأ`).row(); }
  else if (Array.isArray(options)) for (let i = 0; i < options.length; i++) k.text(String(options[i]).slice(0, 60), `ans:${qid}:${i}`).row();
  else if (options && typeof options === 'object') for (const [a, v] of Object.entries(options)) k.text(`${a}. ${String(v).slice(0, 50)}`, `ans:${qid}:${a}`).row();
  return k.text('🏠 إنهاء', 'quiz:stop');
}
async function home(ctx: Context) {
  const u = await user(ctx);
  const trial = u.trialEndsAt && u.trialEndsAt > new Date() ? `🎁 التجربة حتى ${u.trialEndsAt.toLocaleDateString('ar-IQ')}` : '🔓 التجربة غير مفعلة';
  await render(ctx, `🩺 QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية.\n\n${trial}\n💎 الخطة: ${u.plan}\n\nاختر القسم:`, mainMenu);
}
async function subjects(ctx: Context, prefix = 'subject') {
  const rows = await db.subject.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] });
  if (!rows.length) return render(ctx, 'لا توجد مواد مضافة حاليًا.', backMenu);
  return render(ctx, '📚 اختر المادة الدراسية:', subjectMenu(rows, prefix));
}
async function progress(ctx: Context) {
  const u = await user(ctx);
  const [completed, attempts, correct] = await Promise.all([
    db.progress.count({ where: { userId: u.id, completed: true } }),
    db.attempt.count({ where: { userId: u.id } }),
    db.attempt.count({ where: { userId: u.id, correct: true } }),
  ]);
  const accuracy = attempts ? Math.round(correct / attempts * 100) : 0;
  return render(ctx, `📊 تقدمي\n\nالدروس المكتملة: ${completed}\nالمحاولات: ${attempts}\nالإجابات الصحيحة: ${correct}\nالدقة: ${accuracy}%`, backMenu);
}
async function account(ctx: Context) {
  const u = await user(ctx);
  return render(ctx, `👤 حسابي\n\n🆔 Telegram ID: ${u.telegramId}\n👤 الاسم: ${[u.firstName, u.lastName].filter(Boolean).join(' ') || '-'}\n🎯 القسم: ${u.department ?? 'غير محدد'}\n📚 المرحلة: ${u.stage ?? 'غير محددة'}\n💎 الخطة: ${u.plan}\n🎁 التجربة: ${u.trialUsed ? 'مستخدمة' : 'متاحة'}`, new InlineKeyboard().text('🎯 تغيير القسم/المرحلة', 'study_mode').row().text('🏠 الرئيسية', 'home'));
}
async function showQuestion(ctx: Context, kkey: string) {
  const s = sessions.get(kkey);
  if (!s || s.index >= s.ids.length) return finishQuiz(ctx, kkey);
  if (isQuizExpired(s, Date.now())) return finishQuiz(ctx, kkey, true);
  const q = await db.question.findUnique({ where: { id: s.ids[s.index] } });
  if (!q || !canUseInButtonQuiz(q)) return finishQuiz(ctx, kkey);
  const label = s.exam ? `🧠 الاختبار — سؤال ${s.index + 1}/${s.ids.length}` : `❓ تدريب — سؤال ${s.index + 1}/${s.ids.length}`;
  return replyLong(ctx, `${label}\n\n${q.text}`, answerKeyboard(q.type, q.options, q.id));
}
async function startQuiz(ctx: Context, subjectId: number, ministerial: boolean, exam: boolean) {
  const u = await user(ctx);
  if (!(await hasPremiumAccess(u.id))) return render(ctx, '🔒 هذا القسم يحتاج اشتراكًا أو تجربة مفعلة.', backMenu);
  const qs = await db.question.findMany({ where: { subjectId, isMinisterial: ministerial, type: { in: ['MCQ', 'TRUE_FALSE'] } }, select: { id: true } });
  if (!qs.length) return render(ctx, 'لا توجد أسئلة متاحة لهذه المادة حاليًا.', backMenu);
  const ids = qs.map(q => q.id).sort(() => Math.random() - 0.5).slice(0, 10);
  const kkey = key(ctx);
  sessions.set(kkey, { ids, index: 0, correct: 0, answered: 0, ministerial, exam, startedAt: Date.now() });
  await render(ctx, exam ? '🧠 بدأ الاختبار. لديك 15 دقيقة كحد أقصى.' : '❓ بدأ التدريب. أجب عن الأسئلة بالترتيب.');
  return showQuestion(ctx, kkey);
}
async function finishQuiz(ctx: Context, kkey: string, timedOut = false) {
  const s = sessions.get(kkey); sessions.delete(kkey); if (!s) return;
  const accuracy = s.answered ? Math.round(s.correct / s.answered * 100) : 0;
  const unanswered = s.ids.length - s.answered;
  return ctx.reply(`${s.exam ? '🏁 انتهى الاختبار' : '🏁 انتهى التدريب'}${timedOut ? '\n⏰ انتهى الوقت.' : ''}\n\nالنتيجة: ${s.correct}/${s.answered}\nالدقة: ${accuracy}%${unanswered ? `\n⏳ غير مجاب: ${unanswered}` : ''}`, { reply_markup: backMenu });
}

bot.command('start', async ctx => { const u = await user(ctx); if (config.TRIAL_ENABLED && !u.trialUsed) await ensureTrial(u.id); await home(ctx); });
bot.command('help', async ctx => ctx.reply('📖 أوامر QMRMed\n\n/start — الرئيسية\n/study — وضع الدراسة\n/search — البحث\n/ai — المساعد الذكي\n/questions — بنك الأسئلة\n/ministerial — الوزاريات\n/exams — الاختبارات\n/progress — تقدمي\n/plans — الاشتراك\n/trial — التجربة\n/account — حسابي\n/settings — الإعدادات\n/about — عن QMRMed\n/cancel — إلغاء\n/admin — الإدارة'));
bot.command('study', async ctx => { await user(ctx); await ctx.reply('🎯 اختر القسم الدراسي:', { reply_markup: studyDepartmentMenu() }); });
bot.command('search', async ctx => { pending.set(key(ctx), 'search'); await ctx.reply('🔎 أرسل كلمة أو عبارة للبحث داخل محتوى QMRMed المعتمد فقط.', { reply_markup: backMenu }); });
bot.command('ai', async ctx => { pending.set(key(ctx), 'ai'); await ctx.reply('🤖 أرسل سؤالك الطبي. سأبحث أولًا في محتوى QMRMed المعتمد ثم أجيب منه فقط.', { reply_markup: backMenu }); });
bot.command('questions', async ctx => subjects(ctx, 'qbsubject'));
bot.command('ministerial', async ctx => subjects(ctx, 'mqsubject'));
bot.command('exams', async ctx => subjects(ctx, 'examsubject'));
bot.command('progress', progress);
bot.command('plans', async ctx => ctx.reply('💎 اشتراكات QMRMed\n\n🆓 FREE — المحتوى الأساسي\n💙 PLUS — مزايا موسعة\n💜 PRO — الوصول الكامل\n\nالدفع الفعلي سيُربط عبر Telegram Stars قبل الإنتاج.', { reply_markup: new InlineKeyboard().text('💙 PLUS', 'plan:PLUS').text('💜 PRO', 'plan:PRO').row().text('⬅️ الرئيسية', 'home') }));
bot.command('trial', async ctx => { const u = await user(ctx); if (u.trialUsed) return ctx.reply('🎁 تم استخدام التجربة المجانية لهذا الحساب بالفعل.', { reply_markup: backMenu }); const updated = await ensureTrial(u.id); await ctx.reply(`🎁 تم تفعيل التجربة المجانية.\nتنتهي في: ${updated.trialEndsAt?.toLocaleString('ar-IQ') ?? '-'}`, { reply_markup: backMenu }); });
bot.command('account', account);
bot.command('settings', async ctx => ctx.reply('⚙️ الإعدادات\n\n🎯 استخدم /study لتحديد القسم والمرحلة.', { reply_markup: backMenu }));
bot.command('about', async ctx => ctx.reply('ℹ️ QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية تجمع المحتوى الدراسي وبنك الأسئلة والوزاريات والاختبارات والتقدم والمساعد الذكي.', { reply_markup: backMenu }));
bot.command('cancel', async ctx => { pending.delete(key(ctx)); sessions.delete(key(ctx)); await ctx.reply('❌ تم إلغاء العملية الحالية.', { reply_markup: mainMenu }); });

bot.callbackQuery('home', async ctx => { await ctx.answerCallbackQuery(); pending.delete(key(ctx)); sessions.delete(key(ctx)); await home(ctx); });
bot.callbackQuery('subjects', async ctx => { await ctx.answerCallbackQuery(); await subjects(ctx); });
bot.callbackQuery(/^subject:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); const s = await db.subject.findUnique({ where: { id: Number(ctx.match[1]) }, include: { topics: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } }); if (!s) return render(ctx, 'المادة غير موجودة.', backMenu); await render(ctx, `📖 ${s.name}\n\n${s.description ?? 'اختر الموضوع:'}`, topicMenu(s.topics, s.id)); });
bot.callbackQuery(/^topic:(\d+):(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); const t = await db.topic.findUnique({ where: { id: Number(ctx.match[1]) }, include: { lessons: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } }); if (!t) return render(ctx, 'الموضوع غير موجود.', backMenu); await render(ctx, `📘 ${t.name}\n\nاختر الدرس:`, lessonMenu(t.lessons, t.id, Number(ctx.match[2]))); });
bot.callbackQuery(/^topicback:(\d+):(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); const s = await db.subject.findUnique({ where: { id: Number(ctx.match[2]) }, include: { topics: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } }); if (!s) return render(ctx, 'المادة غير موجودة.', backMenu); await render(ctx, `📖 ${s.name}\n\nاختر الموضوع:`, topicMenu(s.topics, s.id)); });
bot.callbackQuery(/^lesson:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); const l = await db.lesson.findUnique({ where: { id: Number(ctx.match[1]) }, include: { topic: true } }); if (!l) return render(ctx, 'الدرس غير موجود.', backMenu); const u = await user(ctx); const p = await db.progress.upsert({ where: { userId_lessonId: { userId: u.id, lessonId: l.id } }, create: { userId: u.id, lessonId: l.id, completed: false }, update: {} }); const k = new InlineKeyboard().text(p.completed ? '✅ مكتمل' : '☑️ تعليم كمكتمل', `complete:${l.id}`).row().text('⬅️ الموضوع', `topicback:${l.topicId}:${l.topic.subjectId}`).row().text('🏠 الرئيسية', 'home'); await replyLong(ctx, `📖 ${l.title}\n\n${l.content}\n\n${l.source ? `📚 المصدر: ${l.source}` : ''}`, k); });
bot.callbackQuery(/^complete:(\d+)$/, async ctx => { await ctx.answerCallbackQuery('تم حفظ التقدم'); const u = await user(ctx); await db.progress.upsert({ where: { userId_lessonId: { userId: u.id, lessonId: Number(ctx.match[1]) } }, create: { userId: u.id, lessonId: Number(ctx.match[1]), completed: true }, update: { completed: true } }); await ctx.editMessageReplyMarkup({ reply_markup: backMenu }); });

bot.callbackQuery('question_bank', async ctx => { await ctx.answerCallbackQuery(); await subjects(ctx, 'qbsubject'); });
bot.callbackQuery('ministerial', async ctx => { await ctx.answerCallbackQuery(); await subjects(ctx, 'mqsubject'); });
bot.callbackQuery(/^qbsubject:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), false, false); });
bot.callbackQuery(/^mqsubject:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), true, false); });
bot.callbackQuery('exams', async ctx => { await ctx.answerCallbackQuery(); await subjects(ctx, 'examsubject'); });
bot.callbackQuery(/^examsubject:(\d+)$/, async ctx => { await ctx.answerCallbackQuery(); await startQuiz(ctx, Number(ctx.match[1]), false, true); });
bot.callbackQuery(/^ans:(\d+):(.+)$/, async ctx => { await ctx.answerCallbackQuery(); const kkey = key(ctx); const s = sessions.get(kkey); if (!s) return ctx.reply('انتهت الجلسة. ابدأ تدريبًا جديدًا من القائمة.'); if (isQuizExpired(s, Date.now())) return finishQuiz(ctx, kkey, true); const qid = Number(ctx.match[1]); if (s.ids[s.index] !== qid) return ctx.reply('⚠️ هذا السؤال لم يعد فعالًا. استخدم آخر سؤال ظاهر.'); const q = await db.question.findUnique({ where: { id: qid } }); if (!q || !canUseInButtonQuiz(q)) return ctx.reply('⚠️ تعذر معالجة هذا السؤال.'); const selected = ctx.match[2]; const selectedValue = resolveSelectedValue(q, selected); const correct = isAnswerCorrect(q, selected); const u = await user(ctx); if (correct) s.correct++; s.answered++; s.index++; await db.attempt.create({ data: { userId: u.id, questionId: q.id, answer: selectedValue, correct } }); await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(correct ? '✅ صحيح' : `❌ خطأ — الصحيح: ${q.answer}`, 'quiz:noop') }); if (s.index >= s.ids.length) return finishQuiz(ctx, kkey); return showQuestion(ctx, kkey); });
bot.callbackQuery('quiz:stop', async ctx => { await ctx.answerCallbackQuery(); await finishQuiz(ctx, key(ctx)); });
bot.callbackQuery('quiz:noop', async ctx => ctx.answerCallbackQuery());
bot.callbackQuery('progress', async ctx => { await ctx.answerCallbackQuery(); await progress(ctx); });
bot.callbackQuery('study_mode', async ctx => { await ctx.answerCallbackQuery(); await render(ctx, '🎯 اختر القسم الدراسي:', studyDepartmentMenu()); });
bot.callbackQuery(/^study:department:(Medicine|Dentistry|Pharmacy)$/, async ctx => { await ctx.answerCallbackQuery(); await render(ctx, `🎯 ${ctx.match[1]}\n\nاختر المرحلة:`, studyStageMenu(ctx.match[1])); });
bot.callbackQuery(/^study:stage:(Medicine|Dentistry|Pharmacy):(\d+)$/, async ctx => { await ctx.answerCallbackQuery('تم حفظ التفضيل'); const u = await user(ctx); await db.user.update({ where: { id: u.id }, data: { department: ctx.match[1], stage: ctx.match[2] } }); await render(ctx, `✅ تم حفظ وضع الدراسة\n\nالقسم: ${ctx.match[1]}\nالمرحلة: ${ctx.match[2]}`, new InlineKeyboard().text('📚 الدراسة', 'subjects').row().text('🏠 الرئيسية', 'home')); });
bot.callbackQuery('search', async ctx => { await ctx.answerCallbackQuery(); pending.set(key(ctx), 'search'); await render(ctx, '🔎 أرسل كلمة أو عبارة للبحث داخل محتوى QMRMed المعتمد فقط.', new InlineKeyboard().text('❌ إلغاء', 'home')); });
bot.callbackQuery('ai', async ctx => { await ctx.answerCallbackQuery(); pending.set(key(ctx), 'ai'); await render(ctx, '🤖 أرسل سؤالك الطبي. سأبحث أولًا في محتوى QMRMed المعتمد ثم أجيب منه فقط.', new InlineKeyboard().text('❌ إلغاء', 'home')); });
bot.callbackQuery('trial', async ctx => { await ctx.answerCallbackQuery(); const u = await user(ctx); if (u.trialUsed) return render(ctx, '🎁 تم استخدام التجربة المجانية لهذا الحساب بالفعل.', backMenu); const updated = await ensureTrial(u.id); await render(ctx, `🎁 تم تفعيل التجربة المجانية.\nتنتهي في: ${updated.trialEndsAt?.toLocaleString('ar-IQ') ?? '-'}`, backMenu); });
bot.callbackQuery('plans', async ctx => { await ctx.answerCallbackQuery(); await render(ctx, '💎 اشتراكات QMRMed\n\n🆓 FREE — المحتوى الأساسي\n💙 PLUS — مزايا موسعة\n💜 PRO — الوصول الكامل\n\nالدفع الفعلي سيُربط قبل الإنتاج.', new InlineKeyboard().text('💙 PLUS', 'plan:PLUS').text('💜 PRO', 'plan:PRO').row().text('⬅️ الرئيسية', 'home')); });
bot.callbackQuery(/^plan:(PLUS|PRO)$/, async ctx => { await ctx.answerCallbackQuery(); await render(ctx, `💎 ${ctx.match[1]}\n\nهذه الواجهة لا تعتبر ضغط الزر دفعًا. سيتم تفعيل الخطة فقط بعد التحقق من عملية الدفع.`, backMenu); });
bot.callbackQuery('account', async ctx => { await ctx.answerCallbackQuery(); await account(ctx); });
bot.callbackQuery('settings', async ctx => { await ctx.answerCallbackQuery(); await render(ctx, '⚙️ الإعدادات\n\n🎯 استخدم «وضع الدراسة» لتحديد القسم والمرحلة.', backMenu); });
bot.callbackQuery('about', async ctx => { await ctx.answerCallbackQuery(); await render(ctx, 'ℹ️ QMRMed\n\nمنصة تعليمية لطلاب المجموعة الطبية.', backMenu); });

function adminGuard(ctx: Context) { return isAdmin(ctx.from?.id ?? ''); }
bot.callbackQuery(/^admin(?::.*)?$/, async ctx => { await ctx.answerCallbackQuery(); if (!adminGuard(ctx)) return render(ctx, 'غير مصرح.'); const data = ctx.callbackQuery.data; try {
  if (data === 'admin:stats') { const d = await getAdminDashboard(); return render(ctx, `📊 Dashboard QMRMed\n\n👥 المستخدمون: ${d.users}\n🆓 FREE: ${d.free}\n💙 PLUS: ${d.plus}\n💜 PRO: ${d.pro}\n\n📚 المواد: ${d.subjects}\n📘 المواضيع: ${d.topics}\n📖 الدروس: ${d.lessons}\n❓ الأسئلة: ${d.questions}\n📝 الوزاريات: ${d.ministerialQuestions}\n🎯 المحاولات: ${d.attempts}\n\n☁️ المصادر المعتمدة: ${d.approvedSources}\n🔎 المفهرسة: ${d.indexedSources}\n🧩 المقاطع: ${d.chunks}`, adminMenu()); }
  if (data === 'admin:users') { const d = await getAdminDashboard(); return render(ctx, `👥 المستخدمون\n\nإجمالي: ${d.users}\nFREE: ${d.free}\nPLUS: ${d.plus}\nPRO: ${d.pro}`, adminMenu()); }
  if (data === 'admin:content') { const d = await getAdminDashboard(); const b = await getContentBreakdown(); return render(ctx, `📚 المحتوى\n\n${b.map(x => `${x.kind}: ${x.count}`).join('\n')}\n\nالمواد: ${d.subjects}\nالمواضيع: ${d.topics}\nالدروس: ${d.lessons}\nالأسئلة: ${d.questions}\nالوزاريات: ${d.ministerialQuestions}\nالمصادر المعتمدة: ${d.approvedSources}\nالمفهرسة: ${d.indexedSources}\nالمقاطع: ${d.chunks}`, adminMenu()); }
  if (data === 'admin:questions') { const d = await getAdminDashboard(); return render(ctx, `📝 الأسئلة والوزاريات\n\n❓ بنك الأسئلة: ${d.questions}\n📝 الوزاريات: ${d.ministerialQuestions}\n🎯 المحاولات: ${d.attempts}`, adminMenu()); }
  if (data === 'admin:drive' || data === 'admin:drive:status') { const s = await getDriveStatus(); const st = s.state; return render(ctx, `☁️ Google Drive\n\nالحالة: ${s.configured ? 'مُهيأ' : 'غير مُهيأ'}\nRoot: ${s.rootFolderId ?? '-'}\nآخر تشغيل: ${st?.lastRunAt?.toLocaleString('ar-IQ') ?? '-'}\nآخر نجاح: ${st?.lastSuccessAt?.toLocaleString('ar-IQ') ?? '-'}\nالملفات: ${st?.filesSeen ?? 0}\nالمفهرسة: ${st?.filesIndexed ?? 0}\n${st?.lastError ? `❌ ${st.lastError}` : '✅ لا يوجد خطأ مسجل'}`, adminDriveMenu()); }
  if (data === 'admin:drive:sync') { const s = await getDriveStatus(); if (!s.configured) return render(ctx, '❌ Google Drive غير مُهيأ.', adminDriveMenu()); await render(ctx, '🔄 جاري مزامنة Google Drive…'); const r = await runAdminDriveSync(); return render(ctx, `✅ اكتملت المزامنة\n\n📄 الملفات: ${r.filesSeen}\n🔎 المفهرسة: ${r.filesIndexed}\n⏭️ المتخطاة: ${r.filesSkipped}\n🗑️ المحذوف فهرسها: ${r.filesRemoved}\n🧩 المقاطع: ${r.chunks}`, adminDriveMenu()); }
  if (data === 'admin:ai') { const r = await omniChat([{ role: 'user', content: 'Reply only: QMRMed OmniRoute OK' }], { temperature: 0 }); return render(ctx, `🤖 OmniRoute\n\n${r}`, adminMenu()); }
  if (data === 'admin:broadcast') { pending.set(key(ctx), 'broadcast'); return render(ctx, '📣 أرسل رسالة الإرسال الجماعي الآن.', backMenu); }
  return render(ctx, '🛠️ لوحة الإدارة', adminMenu());
} catch (e) { console.error('Admin action failed:', e); return render(ctx, `❌ تعذر التنفيذ.\n\n${e instanceof Error ? e.message : String(e)}`, data.startsWith('admin:drive') ? adminDriveMenu() : adminMenu()); } });
bot.callbackQuery('admin', async ctx => { await ctx.answerCallbackQuery(); if (!adminGuard(ctx)) return render(ctx, 'غير مصرح.'); await render(ctx, '🛠️ لوحة الإدارة', adminMenu()); });
bot.command('admin', async ctx => { if (!adminGuard(ctx)) return ctx.reply('غير مصرح.'); await ctx.reply('🛠️ لوحة الإدارة', { reply_markup: adminMenu() }); });

bot.on('message:text', async ctx => {
  const u = await user(ctx); const kkey = key(ctx); const text = ctx.message.text.trim(); if (text.startsWith('/')) return;
  const action = pending.get(kkey); if (!action) return ctx.reply('استخدم /start لفتح لوحة QMRMed.', { reply_markup: mainMenu }); pending.delete(kkey);
  if (action === 'broadcast') { if (!isAdmin(ctx.from.id)) return ctx.reply('غير مصرح.'); const users = await db.user.findMany({ select: { telegramId: true } }); let sent = 0; for (const target of users) { try { await ctx.api.sendMessage(target.telegramId, `📣 QMRMed\n\n${text}`); sent++; } catch {} } return ctx.reply(`✅ اكتمل الإرسال. نجح: ${sent}/${users.length}`); }
  if (action === 'search') { try { const r = await searchApprovedContent(text, { take: 10 }); if (!r.length) return ctx.reply('لم أجد نتيجة مطابقة داخل محتوى QMRMed المعتمد.'); return replyLong(ctx, `🔎 نتائج البحث:\n\n${formatRetrievedContext(r, 10_000)}`); } catch (e) { console.error('Search failed:', e); return ctx.reply('⚠️ تعذر البحث حاليًا.'); } }
  try { return replyLong(ctx, `🤖 QMRMed AI\n\n${await answerMedicalQuestion(text)}`); } catch (e) { console.error('AI failed:', e); return ctx.reply('⚠️ تعذر الوصول إلى المساعد الذكي حاليًا. تأكد من إعداد OmniRoute وقاعدة البيانات.'); }
});

bot.catch(err => console.error('QMRMed Bot error:', err.error));
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

bot.start({ onStart: async info => {
  console.log(`QMRMed Bot started: @${info.username}`);
  await bot.api.setMyCommands([
    ['start', 'فتح QMRMed'], ['help', 'المساعدة والأوامر'], ['study', 'القسم والمرحلة'], ['search', 'البحث في محتوى QMRMed'], ['ai', 'المساعد الذكي'], ['questions', 'بنك الأسئلة'], ['ministerial', 'الأسئلة الوزارية'], ['exams', 'الاختبارات'], ['progress', 'التقدم والنتائج'], ['plans', 'الاشتراكات'], ['trial', 'التجربة المجانية'], ['account', 'حسابي'], ['settings', 'الإعدادات'], ['about', 'عن QMRMed'], ['cancel', 'إلغاء العملية الحالية'], ['admin', 'لوحة الإدارة'],
  ].map(([command, description]) => ({ command, description })));
});
