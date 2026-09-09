import { Bot, Context } from 'grammy';
import { config } from './config.js';
import { db, upsertTelegramUser } from './db.js';
import { ensureTrial, hasPremiumAccess, isAdmin } from './access.js';
import { backMenu, mainMenu, subjectMenu } from './menu.js';

const bot = new Bot(config.BOT_TOKEN);

async function getUser(ctx: Context) {
  if (!ctx.from) throw new Error('Missing Telegram user');
  return upsertTelegramUser(ctx.from);
}

async function home(ctx: Context) {
  const user = await getUser(ctx);
  const trial = user.trialEndsAt && user.trialEndsAt > new Date() ? '🎁 التجربة مفعلة' : '';
  await ctx.reply(
    `🩺 *QMRMed Bot*\n\nمنصة QMRMed التعليمية داخل Telegram.\n\n` +
    `اختر ما تريد:\n${trial}${user.plan !== 'FREE' ? `\n💎 ${user.plan}` : ''}`,
    { parse_mode: 'Markdown', reply_markup: mainMenu },
  );
}

bot.command('start', async (ctx) => {
  const user = await getUser(ctx);
  if (config.TRIAL_ENABLED && !user.trialUsed) await ensureTrial(user.id);
  await home(ctx);
});

bot.command('help', async (ctx) => {
  await ctx.reply('استخدم /start لفتح لوحة QMRMed. يمكنك الدراسة، البحث، حل الأسئلة، إجراء الاختبارات، متابعة تقدمك وإدارة اشتراكك من القائمة الرئيسية.');
});

bot.callbackQuery('home', async (ctx) => { await ctx.answerCallbackQuery(); await home(ctx); });

bot.callbackQuery('subjects', async (ctx) => {
  await ctx.answerCallbackQuery();
  const subjects = await db.subject.findMany({ orderBy: { order: 'asc' } });
  await ctx.editMessageText('📚 *المواد الدراسية*\n\nاختر المادة:', { parse_mode: 'Markdown', reply_markup: subjectMenu(subjects) });
});

bot.callbackQuery(/^subject:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const subject = await db.subject.findUnique({ where: { id }, include: { topics: { orderBy: { order: 'asc' }, include: { lessons: { orderBy: { order: 'asc' } } } } } });
  if (!subject) return ctx.editMessageText('المادة غير موجودة.', { reply_markup: backMenu });
  const topics = subject.topics.map((t) => `• ${t.name} — ${t.lessons.length} درس`).join('\n') || 'لا يوجد محتوى مضاف بعد.';
  await ctx.editMessageText(`📖 *${subject.name}*\n\n${subject.description ?? ''}\n\n${topics}`, { parse_mode: 'Markdown', reply_markup: backMenu });
});

bot.callbackQuery('account', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx);
  await ctx.editMessageText(`👤 *حسابي*\n\nالاسم: ${user.firstName ?? '-'}\nالمستخدم: @${user.username ?? '-'}\nالخطة: ${user.plan}\nالتجربة: ${user.trialEndsAt && user.trialEndsAt > new Date() ? 'مفعلة' : 'غير مفعلة'}`, { parse_mode: 'Markdown', reply_markup: backMenu });
});

bot.callbackQuery('trial', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx);
  if (user.trialUsed) return ctx.editMessageText('🎁 تم استخدام التجربة المجانية لهذا الحساب.', { reply_markup: backMenu });
  const updated = await ensureTrial(user.id);
  await ctx.editMessageText(`🎁 تم تفعيل التجربة المجانية.\nتنتهي في: ${updated.trialEndsAt?.toLocaleString('ar-IQ') ?? '-'}`, { reply_markup: backMenu });
});

bot.callbackQuery('plans', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('💎 *خطط QMRMed*\n\nFREE — الوصول الأساسي\nPLUS — مزايا دراسية موسعة\nPRO — الوصول الكامل والمزايا المتقدمة\n\nالدفع الرقمي داخل Telegram سيُربط عبر Telegram Stars عند تفعيل الإنتاج.', { parse_mode: 'Markdown', reply_markup: backMenu });
});

bot.callbackQuery('question_bank', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx);
  const allowed = await hasPremiumAccess(user.id);
  if (!allowed) return ctx.editMessageText('🔒 بنك الأسئلة متاح بعد تفعيل الاشتراك أو التجربة المجانية.', { reply_markup: backMenu });
  const count = await db.question.count({ where: { isMinisterial: false } });
  await ctx.editMessageText(`❓ *بنك الأسئلة*\n\nعدد الأسئلة المتاحة حاليًا: ${count}\n\nاختر المادة من قسم المواد لبدء التدريب.`, { parse_mode: 'Markdown', reply_markup: backMenu });
});

bot.callbackQuery('ministerial', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx);
  const allowed = await hasPremiumAccess(user.id);
  if (!allowed) return ctx.editMessageText('🔒 الأسئلة الوزارية تتطلب اشتراكًا أو تجربة مفعلة.', { reply_markup: backMenu });
  const count = await db.question.count({ where: { isMinisterial: true } });
  await ctx.editMessageText(`📝 *الأسئلة الوزارية*\n\nعدد الأسئلة المتاحة: ${count}`, { parse_mode: 'Markdown', reply_markup: backMenu });
});

bot.callbackQuery('progress', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx);
  const [completed, attempts, correct] = await Promise.all([
    db.progress.count({ where: { userId: user.id, completed: true } }),
    db.attempt.count({ where: { userId: user.id } }),
    db.attempt.count({ where: { userId: user.id, correct: true } }),
  ]);
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
  await ctx.editMessageText(`📊 *تقدمي ونتائجي*\n\nالدروس المكتملة: ${completed}\nمحاولات الأسئلة: ${attempts}\nالإجابات الصحيحة: ${correct}\nنسبة الدقة: ${accuracy}%`, { parse_mode: 'Markdown', reply_markup: backMenu });
});

bot.callbackQuery('exams', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('🧠 *الاختبارات*\n\nسيتم تشغيل الاختبارات حسب المادة والمستوى والزمن، مع حفظ النتيجة والتقدم لكل مستخدم.', { parse_mode: 'Markdown', reply_markup: backMenu }); });
bot.callbackQuery('search', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('🔎 أرسل كلمة أو موضوعًا للبحث داخل محتوى QMRMed والمصادر المعتمدة فقط.', { reply_markup: backMenu }); });
bot.callbackQuery('ai', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('🤖 *المساعد الذكي*\n\nأرسل سؤالك الطبي في رسالة نصية وسأعالج الطلب وفق مصادر QMRMed عند تفعيل مزود الذكاء الاصطناعي.', { parse_mode: 'Markdown', reply_markup: backMenu }); });
bot.callbackQuery('settings', async (ctx) => { await ctx.answerCallbackQuery(); await ctx.editMessageText('⚙️ *الإعدادات*\n\nسيتم هنا ضبط المرحلة والقسم واللغة والإشعارات وتفضيلات الدراسة.', { parse_mode: 'Markdown', reply_markup: backMenu }); });

bot.on('message:text', async (ctx) => {
  const user = await getUser(ctx);
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  if (text.length < 2) return ctx.reply('اكتب سؤالك أو استخدم /start لفتح القائمة الرئيسية.');
  await ctx.reply(`🔎 استلمت طلبك: «${text}»\n\nالبحث والمساعد الذكي سيستخدمان مصادر QMRMed المحددة فقط بعد ربط محرك البحث/الذكاء الاصطناعي.`);
  if (isAdmin(ctx.from.id)) await ctx.reply('🛠️ وضع الإدارة مفعل لهذا الحساب.');
  void user;
});

bot.catch((err) => console.error('QMRMed Bot error:', err.error));

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

bot.start({ onStart: (info) => console.log(`@${info.username} is running`) });
