import { InlineKeyboard } from 'grammy';
import { config } from './config.js';

function starsLabel(plan: 'PLUS' | 'PRO', days: 30 | 150 | 365) {
  const stars = plan === 'PLUS'
    ? days === 30 ? config.PLUS_MONTH_STARS : days === 150 ? config.PLUS_5MONTH_STARS : config.PLUS_YEAR_STARS
    : days === 30 ? config.PRO_MONTH_STARS : days === 150 ? config.PRO_5MONTH_STARS : config.PRO_YEAR_STARS;
  const duration = days === 30 ? 'شهر' : days === 150 ? '5 أشهر' : 'سنة';
  return `${plan} — ${duration} | ${stars}⭐`;
}

function usdLabel(plan: 'PLUS' | 'PRO', days: 30 | 150 | 365) {
  const stars = plan === 'PLUS'
    ? days === 30 ? config.PLUS_MONTH_STARS : days === 150 ? config.PLUS_5MONTH_STARS : config.PLUS_YEAR_STARS
    : days === 30 ? config.PRO_MONTH_STARS : days === 150 ? config.PRO_5MONTH_STARS : config.PRO_YEAR_STARS;
  const duration = days === 30 ? 'شهر' : days === 150 ? '5 أشهر' : 'سنة';
  const usd = stars / 50;
  return `${plan} — ${duration} | ${usd}$`;
}

export const mainMenu = new InlineKeyboard()
  .text('📚 الدراسة', 'subjects').text('🎯 وضع الدراسة', 'study_mode').row()
  .text('🔎 البحث', 'search').text('🤖 المساعد الذكي', 'ai').row()
  .text('❓ بنك الأسئلة', 'question_bank').text('📝 الوزاريات', 'ministerial').row()
  .text('🧠 الاختبارات', 'exams').text('📊 تقدمي', 'progress').row()
  .text('💎 الاشتراك', 'plans').text('🎁 التجربة', 'trial').row()
  .text('👤 حسابي', 'account').text('⚙️ الإعدادات', 'settings').row()
  .text('ℹ️ عن QMRMed', 'about');
if (config.MINI_APP_URL) mainMenu.row().webApp('📱 QMRMed', config.MINI_APP_URL);

export const backMenu = new InlineKeyboard().text('⬅️ الرئيسية', 'home');
export const cancelMenu = new InlineKeyboard().text('❌ إلغاء', 'home');

export function subjectMenu(subjects: { id: number; name: string }[], prefix = 'subject') {
  const keyboard = new InlineKeyboard();
  for (const subject of subjects) keyboard.text(subject.name, `${prefix}:${subject.id}`).row();
  return keyboard.text('⬅️ الرئيسية', 'home');
}

export function topicMenu(topics: { id: number; name: string }[], subjectId: number) {
  const keyboard = new InlineKeyboard();
  for (const topic of topics) keyboard.text(topic.name, `topic:${topic.id}:${subjectId}`).row();
  return keyboard.text('⬅️ المواد', 'subjects').row().text('🏠 الرئيسية', 'home');
}

export function lessonMenu(lessons: { id: number; title: string }[], topicId: number, subjectId: number) {
  const keyboard = new InlineKeyboard();
  for (const lesson of lessons) keyboard.text(lesson.title, `lesson:${lesson.id}`).row();
  return keyboard.text('⬅️ المواضيع', `topicback:${topicId}:${subjectId}`).row().text('🏠 الرئيسية', 'home');
}

export function studyDepartmentMenu() {
  return new InlineKeyboard()
    .text('🩺 طب عام', 'study:department:Medicine').row()
    .text('🦷 طب أسنان', 'study:department:Dentistry').row()
    .text('💊 صيدلة', 'study:department:Pharmacy').row()
    .text('🏠 الرئيسية', 'home');
}

export function studyStageMenu(department: string) {
  return new InlineKeyboard()
    .text('1️⃣ المرحلة 1', `study:stage:${department}:1`).text('2️⃣ المرحلة 2', `study:stage:${department}:2`).row()
    .text('3️⃣ المرحلة 3', `study:stage:${department}:3`).text('4️⃣ المرحلة 4', `study:stage:${department}:4`).row()
    .text('5️⃣ المرحلة 5', `study:stage:${department}:5`).text('6️⃣ المرحلة 6', `study:stage:${department}:6`).row()
    .text('⬅️ الأقسام', 'study_mode').row().text('🏠 الرئيسية', 'home');
}

export function plansMenu() {
  return new InlineKeyboard()
    .text(starsLabel('PLUS', 30), 'plan:PLUS:30').row()
    .text(starsLabel('PRO', 30), 'plan:PRO:30').row()
    .text(starsLabel('PLUS', 150), 'plan:PLUS:150').row()
    .text(starsLabel('PRO', 150), 'plan:PRO:150').row()
    .text(starsLabel('PLUS', 365), 'plan:PLUS:365').row()
    .text(starsLabel('PRO', 365), 'plan:PRO:365').row()
    .text('💳 الاشتراك والتفعيل الخارجي', 'payment_methods').row()
    .text('🎟️ تفعيل كود اشتراك', 'redeem_code').row()
    .text('📜 الشروط', 'terms').text('🆘 دعم الدفع', 'paysupport').row()
    .text('⬅️ الرئيسية', 'home');
}

export function externalPaymentMenu() {
  return new InlineKeyboard()
    .text(usdLabel('PLUS', 30), 'manual:PLUS:30').row()
    .text(usdLabel('PRO', 30), 'manual:PRO:30').row()
    .text(usdLabel('PLUS', 150), 'manual:PLUS:150').row()
    .text(usdLabel('PRO', 150), 'manual:PRO:150').row()
    .text(usdLabel('PLUS', 365), 'manual:PLUS:365').row()
    .text(usdLabel('PRO', 365), 'manual:PRO:365').row()
    .text('🎟️ لدي كود تفعيل', 'redeem_code').row()
    .text('⬅️ الاشتراكات', 'plans').row().text('🏠 الرئيسية', 'home');
}

export function adminMenu() {
  return new InlineKeyboard()
    .text('📊 Dashboard', 'admin:stats').text('👥 المستخدمون', 'admin:users').row()
    .text('📚 المحتوى', 'admin:content').text('☁️ Google Drive', 'admin:drive').row()
    .text('🤖 OmniRoute / AI', 'admin:ai').text('📣 الإرسال الجماعي', 'admin:broadcast').row()
    .text('📝 الأسئلة والوزاريات', 'admin:questions').row()
    .text('🎟️ أكواد الاشتراك', 'admin:codes').row()
    .text('⬅️ الرئيسية', 'home');
}

export function adminCodesMenu() {
  return new InlineKeyboard()
    .text('💙 PLUS — 30 يوم', 'admin:code:create:PLUS:30').text('💜 PRO — 30 يوم', 'admin:code:create:PRO:30').row()
    .text('💙 PLUS — 150 يوم', 'admin:code:create:PLUS:150').text('💜 PRO — 150 يوم', 'admin:code:create:PRO:150').row()
    .text('💙 PLUS — 365 يوم', 'admin:code:create:PLUS:365').text('💜 PRO — 365 يوم', 'admin:code:create:PRO:365').row()
    .text('📋 عرض الأكواد', 'admin:codes:list').row()
    .text('⬅️ لوحة الإدارة', 'admin');
}

export function adminCodeListMenu(codes: Array<{ id: number; active: boolean }>) {
  const keyboard = new InlineKeyboard();
  for (const code of codes) keyboard.text(`${code.active ? '🟢' : '🔴'} #${code.id}`, `admin:code:view:${code.id}`).row();
  return keyboard.text('➕ إنشاء كود', 'admin:codes').row().text('⬅️ لوحة الإدارة', 'admin');
}

export function adminCodeDetailMenu(id: number, active: boolean) {
  return new InlineKeyboard()
    .text(active ? '⛔ تعطيل الكود' : '✅ تفعيل الكود', `admin:code:toggle:${id}`).row()
    .text('🔄 تحديث', `admin:code:view:${id}`).row()
    .text('📋 كل الأكواد', 'admin:codes:list').row()
    .text('⬅️ لوحة الإدارة', 'admin');
}

export function adminDriveMenu() {
  return new InlineKeyboard()
    .text('🔄 مزامنة الآن', 'admin:drive:sync').row()
    .text('🔎 تحديث الحالة', 'admin:drive:status').row()
    .text('⬅️ لوحة الإدارة', 'admin');
}
