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

export function adminMenu() {
  return new InlineKeyboard()
    .text('📊 Dashboard', 'admin:stats').text('👥 المستخدمون', 'admin:users').row()
    .text('📚 المحتوى', 'admin:content').text('☁️ Google Drive', 'admin:drive').row()
    .text('🤖 OmniRoute / AI', 'admin:ai').text('📣 الإرسال الجماعي', 'admin:broadcast').row()
    .text('📝 الأسئلة والوزاريات', 'admin:questions').row()
    .text('⬅️ الرئيسية', 'home');
}

export function adminDriveMenu() {
  return new InlineKeyboard()
    .text('🔄 مزامنة الآن', 'admin:drive:sync').row()
    .text('🔎 تحديث الحالة', 'admin:drive:status').row()
    .text('⬅️ لوحة الإدارة', 'admin');
}
