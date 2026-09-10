import { InlineKeyboard } from 'grammy';

export const mainMenu = new InlineKeyboard()
  .text('📚 الدراسة', 'subjects').text('🎯 وضع الدراسة', 'study_mode').row()
  .text('🔎 البحث', 'search').text('🤖 المساعد الذكي', 'ai').row()
  .text('❓ بنك الأسئلة', 'question_bank').text('📝 الوزاريات', 'ministerial').row()
  .text('🧠 الاختبارات', 'exams').text('📊 تقدمي', 'progress').row()
  .text('💎 الاشتراك', 'plans').text('🎁 التجربة', 'trial').row()
  .text('👤 حسابي', 'account').text('⚙️ الإعدادات', 'settings').row()
  .text('ℹ️ عن QMRMed', 'about');

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
    .text('💙 PLUS — Telegram Stars', 'plan:PLUS').row()
    .text('💜 PRO — Telegram Stars', 'plan:PRO').row()
    .text('💳 طرق الدفع الأخرى', 'payment_methods').row()
    .text('🎟️ تفعيل كود اشتراك', 'redeem_code').row()
    .text('📜 الشروط', 'terms').text('🆘 دعم الدفع', 'paysupport').row()
    .text('⬅️ الرئيسية', 'home');
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
    .text('💙 PLUS — 90 يوم', 'admin:code:create:PLUS:90').text('💜 PRO — 90 يوم', 'admin:code:create:PRO:90').row()
    .text('💙 PLUS — 365 يوم', 'admin:code:create:PLUS:365').text('💜 PRO — 365 يوم', 'admin:code:create:PRO:365').row()
    .text('⬅️ لوحة الإدارة', 'admin');
}

export function adminDriveMenu() {
  return new InlineKeyboard()
    .text('🔄 مزامنة الآن', 'admin:drive:sync').row()
    .text('🔎 تحديث الحالة', 'admin:drive:status').row()
    .text('⬅️ لوحة الإدارة', 'admin');
}
