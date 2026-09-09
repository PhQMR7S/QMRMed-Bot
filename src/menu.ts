import { InlineKeyboard } from 'grammy';

export const mainMenu = new InlineKeyboard()
  .text('📚 المواد الدراسية', 'subjects').row()
  .text('🔎 البحث', 'search').text('🤖 المساعد الذكي', 'ai').row()
  .text('❓ بنك الأسئلة', 'question_bank').text('📝 الأسئلة الوزارية', 'ministerial').row()
  .text('🧠 الاختبارات', 'exams').text('📊 تقدمي ونتائجي', 'progress').row()
  .text('💎 الاشتراك', 'plans').text('🎁 التجربة المجانية', 'trial').row()
  .text('👤 حسابي', 'account').text('⚙️ الإعدادات', 'settings');

export const backMenu = new InlineKeyboard().text('⬅️ الرئيسية', 'home');

export function subjectMenu(subjects: { id: number; name: string }[]) {
  const keyboard = new InlineKeyboard();
  for (const subject of subjects) keyboard.text(subject.name, `subject:${subject.id}`).row();
  return keyboard.text('⬅️ الرئيسية', 'home');
}
