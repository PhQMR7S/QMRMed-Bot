import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractText, getDocumentProxy } from 'unpdf';
import { Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { routedChat, type AIMessage } from './ai-routing.js';
import { upsertTelegramUser } from './db.js';
import type { Plan } from '@prisma/client';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ARCHIVE_ROOT = join(process.cwd(), '.qmrmed', 'file-ai');
const SIGNATURE = 'QMRMed — Medical Education Platform';
const AI_DIRECT_MAX_CHARS = 7_500;
const AI_CHUNK_TARGET_CHARS = 7_000;
const AI_EVIDENCE_MAX_CHARS = 1_400;
const AI_SYNTHESIS_MAX_CHARS = 7_000;
const operationLocks = new Map<string, Promise<void>>();

type Operation = 'explain' | 'summary' | 'qa' | 'mcq' | 'true_false' | 'fill_blank' | 'matching' | 'cases' | 'viva' | 'mind_map' | 'flowchart' | 'comparison' | 'timeline' | 'diagnostic' | 'exam';
type ArchiveItem = { id: string; userId: string; sourceName: string; mimeType: string; operation: Operation; createdAt: string; text: string; result: string; pdfPath?: string };

const operationLabels: Record<Operation, string> = {
  explain: 'شرح المحاضرة', summary: 'تلخيص دقيق', qa: 'أسئلة قصيرة', mcq: 'MCQ', true_false: 'صح / خطأ', fill_blank: 'أكمل الفراغ', matching: 'مطابقة', cases: 'حالات سريرية', viva: 'Viva / شفوي', mind_map: 'خريطة ذهنية', flowchart: 'مخطط انسيابي', comparison: 'جدول مقارنة', timeline: 'خط زمني', diagnostic: 'خوارزمية تشخيصية', exam: 'اختبار تجريبي',
};

function userDir(userId: string) { return join(ARCHIVE_ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, '_')); }
function archivePath(userId: string, id: string) { return join(userDir(userId), `${id}.json`); }
function safeName(name: string) { return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'qmrmed'; }
function userId(ctx: Context) { if (!ctx.from) throw new Error('Missing Telegram user'); return String(ctx.from.id); }
function menu() {
  return new InlineKeyboard()
    .text('شرح', 'fileai:op:explain').text('تلخيص', 'fileai:op:summary').row()
    .text('أسئلة قصيرة', 'fileai:op:qa').text('MCQ', 'fileai:op:mcq').row()
    .text('صح/خطأ', 'fileai:op:true_false').text('أكمل الفراغ', 'fileai:op:fill_blank').row()
    .text('مطابقة', 'fileai:op:matching').text('حالات سريرية', 'fileai:op:cases').row()
    .text('Viva', 'fileai:op:viva').text('خريطة ذهنية', 'fileai:op:mind_map').row()
    .text('مخطط انسيابي', 'fileai:op:flowchart').text('مقارنة', 'fileai:op:comparison').row()
    .text('خط زمني', 'fileai:op:timeline').text('خوارزمية تشخيصية', 'fileai:op:diagnostic').row()
    .text('اختبار تجريبي', 'fileai:op:exam').row().text('أرشيفي', 'fileai:archive');
}
function resultMenu(id: string) {
  return new InlineKeyboard().text('إعادة التوليد', `fileai:redo:${id}`).text('PDF', `fileai:pdf:${id}`).row().text('مشاركة / إرسال', `fileai:share:${id}`).text('أرشيفي', 'fileai:archive').row().text('عملية أخرى', `fileai:choose:${id}`).text('الرئيسية', 'home');
}
async function archive(item: ArchiveItem) { await mkdir(userDir(item.userId), { recursive: true }); await writeFile(archivePath(item.userId, item.id), JSON.stringify(item, null, 2), 'utf8'); }
async function loadArchive(uid: string, id: string) { try { return JSON.parse(await readFile(archivePath(uid, id), 'utf8')) as ArchiveItem; } catch { return null; } }
async function listArchive(uid: string) {
  await mkdir(userDir(uid), { recursive: true });
  const names = (await readdir(userDir(uid))).filter(x => x.endsWith('.json')).sort().reverse().slice(0, 12);
  const items: ArchiveItem[] = [];
  for (const name of names) { try { items.push(JSON.parse(await readFile(join(userDir(uid), name), 'utf8')) as ArchiveItem); } catch {} }
  return items;
}

async function extractOffice(buffer: Buffer, ext: string) {
  const work = join(tmpdir(), `qmrmed-office-${randomUUID()}`); await mkdir(work, { recursive: true });
  const input = join(work, `input.${ext}`); await writeFile(input, buffer);
  const { stdout } = await execFileAsync('python3', ['scripts/extract-office.py', input], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}
async function extractTextFromBuffer(buffer: Buffer, mimeType: string, fileName: string) {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (mimeType === 'application/pdf' || ext === 'pdf') { const pdf = await getDocumentProxy(new Uint8Array(buffer)); const result = await extractText(pdf, { mergePages: true }); return String(result.text ?? '').trim(); }
  if (['docx', 'pptx'].includes(ext) || mimeType.includes('wordprocessingml') || mimeType.includes('presentationml')) return extractOffice(buffer, ext === 'pptx' ? 'pptx' : 'docx');
  if (['txt', 'md', 'csv', 'json'].includes(ext) || mimeType.startsWith('text/')) return buffer.toString('utf8').trim();
  if (mimeType.startsWith('image/')) {
    const work = join(tmpdir(), `qmrmed-ocr-${randomUUID()}`); await mkdir(work, { recursive: true }); const input = join(work, safeName(fileName)); await writeFile(input, buffer);
    try { const { stdout } = await execFileAsync('tesseract', [input, 'stdout', '-l', 'ara+eng'], { maxBuffer: 8 * 1024 * 1024 }); return stdout.trim(); }
    catch { throw new Error('تعذر استخراج النص من الصورة. ثبّت Tesseract مع حزم العربية والإنجليزية على الخادم.'); }
  }
  throw new Error('نوع الملف غير مدعوم حاليًا. استخدم PDF أو PowerPoint أو Word أو TXT/Markdown/CSV/JSON أو صورة.');
}

function promptFor(operation: Operation, sourceName: string, text: string) {
  const common = `أنت QMRMed Lecture Intelligence. عالج ملف المحاضرة "${sourceName}".\nاعتمد حصريًا على النص المستخرج من الملف. لا تضف حقائق خارجية غير مدعومة.\nإذا كانت المعلومة غير موجودة أو غير واضحة، صرّح بذلك بدل التخمين.\nحافظ على المصطلحات الطبية بدقة.\nأخرج محتوى منظمًا وواضحًا للطلاب.\nفي النهاية أضف: ${SIGNATURE}`;
  const task: Record<Operation, string> = {
    explain: 'اشرح المحاضرة شرحًا أكاديميًا واضحًا مرتبًا حسب المفاهيم والعناوين مع إبراز نقاط الامتحان.',
    summary: 'أنشئ ملخصًا دقيقًا وعالي العائد مرتبًا بعناوين ونقاط مع الحفاظ على التفاصيل الطبية المهمة.',
    qa: 'أنشئ أسئلة وأجوبة قصيرة تغطي أهم المعلومات مع الإجابة الصحيحة بعد كل سؤال.',
    mcq: 'أنشئ 20 سؤال MCQ من الملف فقط، أربعة خيارات لكل سؤال، مع الإجابة الصحيحة وشرح مختصر.',
    true_false: 'أنشئ 20 سؤال صح/خطأ من الملف فقط، مع الإجابة والتفسير المختصر.',
    fill_blank: 'أنشئ 20 سؤال أكمل الفراغ من الملف فقط، مع الإجابة الصحيحة.',
    matching: 'أنشئ أسئلة مطابقة تربط المصطلحات بالمفاهيم أو التعريفات الموجودة في الملف، مع مفتاح الإجابة.',
    cases: 'أنشئ 8 حالات سريرية مبنية فقط على معلومات الملف، ولكل حالة المعطيات والسؤال والإجابة والتفسير.',
    viva: 'أنشئ أسئلة Viva/شفوي عالية العائد مع إجابات نموذجية قصيرة من الملف فقط.',
    mind_map: 'حوّل المحاضرة إلى خريطة ذهنية هرمية واضحة باستخدام عناوين متداخلة وعلاقات سبب/نتيجة عند وجودها.',
    flowchart: 'حوّل العمليات أو التسلسلات المهمة إلى مخططات انسيابية نصية باستخدام الأسهم والخطوات.',
    comparison: 'استخرج أهم المقارنات من المحاضرة وضعها في جداول نصية واضحة.',
    timeline: 'استخرج أي تسلسل زمني أو مراحل أو تطور وارد في الملف وقدمه كخط زمني واضح. إذا لم يوجد اذكر ذلك.',
    diagnostic: 'حوّل المعلومات التشخيصية الواردة في الملف إلى خوارزمية تشخيصية خطوة بخطوة دون إضافة معلومات خارج الملف.',
    exam: 'أنشئ اختبارًا تجريبيًا من 30 سؤالًا متنوعًا من محتوى الملف فقط، مع مفتاح إجابة وشرح مختصر.',
  };
  return `${common}\n\nالمطلوب:\n${task[operation]}\n\nالنص المستخرج:\n${text}`;
}
function splitText(text: string, target = AI_CHUNK_TARGET_CHARS) {
  const chunks: string[] = []; let rest = text.trim();
  while (rest.length > target) { let cut = Math.max(rest.lastIndexOf('\n\n', target), rest.lastIndexOf('\n', target), rest.lastIndexOf(' ', target)); if (cut < Math.floor(target * 0.65)) cut = target; chunks.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trimStart(); }
  if (rest) chunks.push(rest); return chunks;
}
async function chat(plan: Plan, messages: AIMessage[], temperature = 0.2) { return routedChat('study', plan, messages, temperature); }
async function generate(operation: Operation, plan: Plan, sourceName: string, text: string) {
  if (text.length <= AI_DIRECT_MAX_CHARS) return chat(plan, [{ role: 'system', content: 'QMRMed Lecture Intelligence: grounded file transformation only.' }, { role: 'user', content: promptFor(operation, sourceName, text) }]);
  const chunks = splitText(text); const evidence: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const instruction = `حلّل الجزء ${i + 1} من ${chunks.length} من ملف "${sourceName}". استخرج فقط المعلومات اللازمة لتنفيذ المهمة التالية، بدون مقدمات أو معلومات خارج النص. المهمة: ${operationLabels[operation]}. أعد دليلًا موجزًا يصلح للدمج النهائي، بحد أقصى ${AI_EVIDENCE_MAX_CHARS} حرفًا.\n\n${chunks[i]}`;
    evidence.push(await chat(plan, [{ role: 'system', content: 'QMRMed source-grounded extraction. Never invent facts.' }, { role: 'user', content: instruction }], 0.1));
  }
  const combinedEvidence = evidence.join('\n\n--- جزء جديد ---\n\n').slice(0, AI_SYNTHESIS_MAX_CHARS);
  return chat(plan, [{ role: 'system', content: 'QMRMed Lecture Intelligence: synthesize only from the supplied evidence. Do not invent or import outside medical facts.' }, { role: 'user', content: promptFor(operation, sourceName, combinedEvidence) }]);
}
async function withUserLock<T>(uid: string, task: () => Promise<T>): Promise<T> {
  const previous = operationLocks.get(uid) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  operationLocks.set(uid, queued);
  try { await previous; return await task(); }
  finally { release(); if (operationLocks.get(uid) === queued) operationLocks.delete(uid); }
}
async function createPdf(item: ArchiveItem) {
  const work = join(tmpdir(), `qmrmed-pdf-${randomUUID()}`); await mkdir(work, { recursive: true });
  const input = join(work, 'input.json'); const output = join(work, `${safeName(item.sourceName)}-${item.operation}.pdf`);
  await writeFile(input, JSON.stringify({ title: `${operationLabels[item.operation]} — ${item.sourceName}`, text: item.result, signature: SIGNATURE, output }), 'utf8');
  try { await execFileAsync('python3', ['scripts/render-pdf.py', input], { maxBuffer: 2 * 1024 * 1024 }); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); throw new Error(`تعذر إنشاء PDF. ثبّت ReportLab وrlbidi على Ubuntu ثم أعد المحاولة. ${detail.slice(0, 300)}`); }
  item.pdfPath = output; await archive(item); return output;
}
async function sendPdf(ctx: Context, item: ArchiveItem) { if (!item.pdfPath || !existsSync(item.pdfPath)) await createPdf(item); return ctx.replyWithDocument(new InputFile(item.pdfPath!, `${safeName(item.sourceName)}-${item.operation}.pdf`)); }
async function replyLong(ctx: Context, value: string, markup?: InlineKeyboard) { const limit = 3900; let rest = value; while (rest.length > limit) { let cut = Math.max(rest.lastIndexOf('\n', limit), rest.lastIndexOf(' ', limit)); if (cut < 2000) cut = limit; await ctx.reply(rest.slice(0, cut)); rest = rest.slice(cut).trimStart(); } await ctx.reply(rest || '—', markup ? { reply_markup: markup } : undefined); }
async function processOperation(ctx: Context, item: ArchiveItem, plan: Plan) {
  return withUserLock(item.userId, async () => {
    await ctx.reply(`جاري ${operationLabels[item.operation]} من محتوى الملف فقط…`);
    item.result = await generate(item.operation, plan, item.sourceName, item.text);
    item.createdAt = new Date().toISOString(); await archive(item);
    await replyLong(ctx, `تم إنشاء ${operationLabels[item.operation]} من الملف.\n\n${item.result.slice(0, 18_000)}`, resultMenu(item.id));
    try { await sendPdf(ctx, item); } catch (error) { await ctx.reply(error instanceof Error ? error.message : String(error)); }
  });
}
export function registerFileAiHandlers(bot: Bot) {
  bot.on('message:document', async ctx => {
    const doc = ctx.message.document; const sourceName = doc.file_name ?? 'qmrmed-file';
    if (!doc.file_size || doc.file_size > MAX_FILE_BYTES) return ctx.reply('الملف أكبر من حد Telegram للتنزيل عبر Bot API (20 MB).');
    try { const file = await ctx.getFile(); if (!file.file_path) throw new Error('تعذر الحصول على مسار الملف من Telegram.'); const response = await fetch(`https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`); if (!response.ok) throw new Error(`فشل تنزيل الملف من Telegram: ${response.status}`); const text = await extractTextFromBuffer(Buffer.from(await response.arrayBuffer()), doc.mime_type ?? '', sourceName); if (text.length < 40) throw new Error('لم أستطع استخراج نص قابل للمعالجة من الملف. قد يكون PDF ممسوحًا ضوئيًا ويحتاج OCR.'); const item: ArchiveItem = { id: randomUUID(), userId: userId(ctx), sourceName, mimeType: doc.mime_type ?? 'application/octet-stream', operation: 'summary', createdAt: new Date().toISOString(), text, result: '' }; await archive(item); await ctx.reply(`تم استلام الملف: ${sourceName}\n\nاختر ما تريد إنشاءه من محتوى الملف.\n\nكل نتيجة تعتمد على الملف نفسه فقط، ويمكن حفظها وإرسالها كـ PDF.`, { reply_markup: menu() }); } catch (error) { await ctx.reply(error instanceof Error ? error.message : String(error)); }
  });
  bot.on('message:photo', async ctx => {
    const photo = ctx.message.photo.at(-1); if (!photo) return;
    try { const file = await ctx.api.getFile(photo.file_id); if (!file.file_path) throw new Error('تعذر الحصول على مسار الصورة.'); const response = await fetch(`https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`); if (!response.ok) throw new Error(`فشل تنزيل الصورة: ${response.status}`); const sourceName = `lecture-${Date.now()}.jpg`; const text = await extractTextFromBuffer(Buffer.from(await response.arrayBuffer()), 'image/jpeg', sourceName); if (text.length < 40) throw new Error('لم أستطع استخراج نص من الصورة. تأكد من وضوحها.'); const item: ArchiveItem = { id: randomUUID(), userId: userId(ctx), sourceName, mimeType: 'image/jpeg', operation: 'summary', createdAt: new Date().toISOString(), text, result: '' }; await archive(item); await ctx.reply('تمت قراءة الصورة. اختر العملية المطلوبة:', { reply_markup: menu() }); } catch (error) { await ctx.reply(error instanceof Error ? error.message : String(error)); }
  });
  bot.callbackQuery(/^fileai:op:(.+)$/, async ctx => { await ctx.answerCallbackQuery(); const operation = ctx.match[1] as Operation; const items = await listArchive(userId(ctx)); const item = items.find(x => !x.result); if (!item || !operationLabels[operation]) return ctx.reply('لم أجد ملفًا مرفوعًا ينتظر المعالجة. أرسل الملف أولًا.'); item.operation = operation; const user = await upsertTelegramUser(ctx.from as NonNullable<typeof ctx.from>); await processOperation(ctx, item, user.plan as Plan); });
  bot.callbackQuery(/^fileai:(choose|redo|pdf|share):(.+)$/, async ctx => { await ctx.answerCallbackQuery(); const action = ctx.match[1]; const item = await loadArchive(userId(ctx), ctx.match[2]); if (!item) return ctx.reply('لم أجد هذه النتيجة في أرشيفك.'); if (action === 'choose') return ctx.reply('اختر عملية جديدة:', { reply_markup: menu() }); if (action === 'pdf' || action === 'share') return sendPdf(ctx, item); item.result = ''; const user = await upsertTelegramUser(ctx.from as NonNullable<typeof ctx.from>); return processOperation(ctx, item, user.plan as Plan); });
  bot.callbackQuery('fileai:archive', async ctx => { await ctx.answerCallbackQuery(); const items = await listArchive(userId(ctx)); if (!items.length) return ctx.reply('أرشيف الملفات فارغ.'); const keyboard = new InlineKeyboard(); for (const item of items) keyboard.text(`${operationLabels[item.operation]} — ${item.sourceName.slice(0, 28)}`, `fileai:share:${item.id}`).row(); keyboard.text('الرئيسية', 'home'); return ctx.reply('أرشيف QMRMed:', { reply_markup: keyboard }); });
  bot.command('archive', async ctx => { const items = await listArchive(userId(ctx)); if (!items.length) return ctx.reply('أرشيف الملفات فارغ.'); const keyboard = new InlineKeyboard(); for (const item of items) keyboard.text(`${operationLabels[item.operation]} — ${item.sourceName.slice(0, 28)}`, `fileai:share:${item.id}`).row(); return ctx.reply('أرشيف QMRMed:', { reply_markup: keyboard }); });
}
