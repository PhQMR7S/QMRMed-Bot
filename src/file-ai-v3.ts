import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { Bot, Context, InlineKeyboard } from 'grammy';
import type { FileOperationType } from '@prisma/client';
import { db, upsertTelegramUser } from './db.js';
import { config } from './config.js';
import { enqueueJob } from './ai-jobs.js';
import { routedChat } from './ai-routing.js';

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CHUNK_SIZE = 7000;
const TELEGRAM_LIMIT = 3900;

type Page = { pageNumber: number; text: string };
type Chunk = { index: number; text: string; pageStart: number; pageEnd: number };

const labels: Record<FileOperationType, string> = {
  EXPLAIN: 'شرح', SUMMARY: 'تلخيص', QA: 'أسئلة وأجوبة', MCQ: 'MCQ', TRUE_FALSE: 'صح/خطأ', FILL_BLANK: 'أكمل الفراغ', MATCHING: 'مطابقة', CASES: 'حالات سريرية', VIVA: 'Viva', MIND_MAP: 'خريطة ذهنية', FLOWCHART: 'مخطط انسيابي', COMPARISON: 'مقارنة', TIMELINE: 'خط زمني', DIAGNOSTIC: 'خوارزمية تشخيصية', EXAM: 'اختبار تجريبي', ASK_FILE: 'اسأل الملف',
};

function splitTelegram(text: string) {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > TELEGRAM_LIMIT) {
    let cut = Math.max(rest.lastIndexOf('\n', TELEGRAM_LIMIT), rest.lastIndexOf(' ', TELEGRAM_LIMIT));
    if (cut < TELEGRAM_LIMIT * 0.6) cut = TELEGRAM_LIMIT;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out.length ? out : [''];
}

function mainMenu(fileId: string) {
  return new InlineKeyboard()
    .text('📘 الفهم', `filev3:group:${fileId}:understand`).text('❓ الأسئلة', `filev3:group:${fileId}:questions`).row()
    .text('🩺 الحالات', `filev3:group:${fileId}:cases`).text('🎓 الاختبار', `filev3:group:${fileId}:exam`).row()
    .text('🧠 أدوات', `filev3:group:${fileId}:tools`).text('🔎 اسأل الملف', `filev3:ask:${fileId}`).row()
    .text('📚 الأرشيف', `filev3:archive:${fileId}`);
}

function groupMenu(fileId: string, group: string) {
  const k = new InlineKeyboard();
  const add = (text: string, type: FileOperationType) => k.text(text, `filev3:op:${fileId}:${type}`);
  if (group === 'understand') { add('📄 تلخيص', 'SUMMARY'); add('📘 شرح', 'EXPLAIN'); k.row(); add('📊 مقارنة', 'COMPARISON'); add('🧭 خط زمني', 'TIMELINE'); }
  if (group === 'questions') { add('MCQ', 'MCQ'); add('❓ Q&A', 'QA'); k.row(); add('✅ صح/خطأ', 'TRUE_FALSE'); add('📝 فراغات', 'FILL_BLANK'); k.row(); add('🔗 مطابقة', 'MATCHING'); add('🎤 Viva', 'VIVA'); }
  if (group === 'cases') { add('🩺 حالات', 'CASES'); add('🧠 تشخيص', 'DIAGNOSTIC'); }
  if (group === 'exam') add('🎓 اختبار تجريبي', 'EXAM');
  if (group === 'tools') { add('🧠 خريطة ذهنية', 'MIND_MAP'); add('🔀 مخطط انسيابي', 'FLOWCHART'); }
  return k.row().text('⬅️ الملف', `filev3:file:${fileId}`);
}

async function downloadTelegramFile(fileId: string) {
  const response = await fetch(`https://api.telegram.org/file/bot${config.BOT_TOKEN}/${fileId}`);
  if (!response.ok) throw new Error(`TELEGRAM_DOWNLOAD_${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  return buffer;
}

async function extractOffice(buffer: Buffer, ext: string) {
  const work = join(tmpdir(), `qmrmed-office-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  const input = join(work, `input.${ext}`);
  await writeFile(input, buffer);
  const { stdout } = await execFileAsync('python3', ['scripts/extract-office.py', input], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

async function extractPages(buffer: Buffer, mimeType: string, fileName: string): Promise<Page[]> {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const raw = await extractText(pdf, { mergePages: false }) as unknown as { text?: unknown };
    const values = Array.isArray(raw.text) ? raw.text : [raw.text ?? ''];
    return values.map((text, i) => ({ pageNumber: i + 1, text: String(text ?? '').trim() })).filter(p => p.text.length > 0);
  }
  if (['docx', 'pptx'].includes(ext) || mimeType.includes('wordprocessingml') || mimeType.includes('presentationml')) return [{ pageNumber: 1, text: await extractOffice(buffer, ext === 'pptx' ? 'pptx' : 'docx') }];
  if (['txt', 'md', 'csv', 'json'].includes(ext) || mimeType.startsWith('text/')) return [{ pageNumber: 1, text: buffer.toString('utf8').trim() }];
  throw new Error('UNSUPPORTED_FILE_TYPE');
}

function makeChunks(pages: Page[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current = '';
  let start = 0;
  let end = 0;
  const flush = () => { if (current.trim()) chunks.push({ index: chunks.length, text: current.trim(), pageStart: start, pageEnd: end }); current = ''; start = 0; end = 0; };
  for (const page of pages) {
    const pieces = page.text.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}(?:\\n|\\s|$)`, 'g')) ?? [page.text];
    for (const piece of pieces) {
      const clean = piece.trim();
      if (!clean) continue;
      if (!current) start = page.pageNumber;
      if (current && current.length + clean.length + 1 > CHUNK_SIZE) flush();
      current = current ? `${current}\n${clean}` : clean;
      end = page.pageNumber;
    }
  }
  flush();
  return chunks;
}

async function telegramSend(chatId: string, text: string, keyboard?: InlineKeyboard) {
  const chunks = splitTelegram(text);
  for (let i = 0; i < chunks.length; i += 1) {
    const body: Record<string, unknown> = { chat_id: chatId, text: chunks[i] };
    if (i === chunks.length - 1 && keyboard) body.reply_markup = (keyboard as unknown as { inline_keyboard: unknown }).inline_keyboard;
    await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
}

async function ingest(job: { fileId: string }) {
  const file = await db.file.findUnique({ where: { id: job.fileId } });
  if (!file) throw new Error('FILE_NOT_FOUND');
  const user = await db.user.findUnique({ where: { id: file.userId }, select: { telegramId: true } });
  if (!user) throw new Error('USER_NOT_FOUND');
  await db.file.update({ where: { id: file.id }, data: { status: 'DOWNLOADING', errorCode: null, errorMessage: null } });
  const buffer = await downloadTelegramFile(file.storageKey);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const duplicate = await db.file.findFirst({ where: { userId: file.userId, sha256, id: { not: file.id }, status: { not: 'DELETED' } }, select: { id: true } });
  if (duplicate) { await db.file.update({ where: { id: file.id }, data: { status: 'CANCELLED', errorCode: 'DUPLICATE_FILE', errorMessage: `Duplicate of ${duplicate.id}` } }); return; }
  await db.file.update({ where: { id: file.id }, data: { status: 'EXTRACTING', sha256 } });
  const pages = await extractPages(buffer, file.mimeType, file.originalName);
  const chunks = makeChunks(pages);
  if (!chunks.length) throw new Error('NO_EXTRACTABLE_TEXT');
  await db.$transaction(async tx => {
    await tx.filePage.deleteMany({ where: { fileId: file.id } });
    await tx.fileChunk.deleteMany({ where: { fileId: file.id } });
    await tx.file.update({ where: { id: file.id }, data: { status: 'PARSING', pageCount: pages.length, extractedChars: pages.reduce((n, p) => n + p.text.length, 0), contentFingerprint: createHash('sha256').update(pages.map(p => p.text).join('\n')).digest('hex') } });
    const pageIds = new Map<number, string>();
    for (const page of pages) { const id = randomUUID(); pageIds.set(page.pageNumber, id); await tx.filePage.create({ data: { id, fileId: file.id, pageNumber: page.pageNumber, text: page.text, charCount: page.text.length, contentHash: createHash('sha256').update(page.text).digest('hex') } }); }
    for (const chunk of chunks) await tx.fileChunk.create({ data: { id: randomUUID(), fileId: file.id, pageId: pageIds.get(chunk.pageStart), chunkIndex: chunk.index, text: chunk.text, charCount: chunk.text.length, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, contentHash: createHash('sha256').update(chunk.text).digest('hex') } });
    await tx.file.update({ where: { id: file.id }, data: { status: 'INDEXING', readyAt: new Date() } });
  });
  await db.file.update({ where: { id: file.id }, data: { status: 'READY' } });
  await db.aIJob.create({ data: { id: randomUUID(), userId: file.userId, fileId: file.id, type: 'FILE_ANALYSIS', idempotencyKey: `analysis:${file.id}:1`, payload: { fileId: file.id }, maxAttempts: 3 } }).catch(() => undefined);
  await telegramSend(user.telegramId, `📄 تم تجهيز الملف «${file.originalName}».\nاختر العملية المطلوبة:`, mainMenu(file.id));
}

const tasks: Record<FileOperationType, string> = {
  EXPLAIN: 'اشرح المحتوى أكاديميًا وبشكل منظم مع إبراز النقاط المهمة للامتحان.', SUMMARY: 'أنشئ ملخصًا عالي العائد ودقيقًا.', QA: 'أنشئ أسئلة وأجوبة قصيرة تغطي أهم المعلومات.', MCQ: 'أنشئ 20 MCQ، أربعة خيارات، مع الإجابة والتفسير.', TRUE_FALSE: 'أنشئ 20 سؤال صح/خطأ مع الإجابة والتفسير.', FILL_BLANK: 'أنشئ 20 سؤال أكمل الفراغ مع الإجابة.', MATCHING: 'أنشئ أسئلة مطابقة مع مفتاح الإجابة.', CASES: 'أنشئ 8 حالات سريرية مبنية فقط على الملف مع الإجابات والتفسير.', VIVA: 'أنشئ أسئلة Viva عالية العائد مع إجابات نموذجية.', MIND_MAP: 'حوّل المحتوى إلى خريطة ذهنية هرمية.', FLOWCHART: 'حوّل التسلسلات أو الخوارزميات إلى مخطط انسيابي نصي.', COMPARISON: 'استخرج أهم المقارنات في جداول واضحة.', TIMELINE: 'استخرج أي تسلسل زمني أو مراحل، وإذا لم يوجد صرّح بذلك.', DIAGNOSTIC: 'أنشئ خوارزمية تشخيصية من المعلومات الواردة في الملف فقط.', EXAM: 'أنشئ اختبارًا تجريبيًا من 30 سؤالًا متنوعًا مع مفتاح الإجابة.', ASK_FILE: 'أجب عن سؤال المستخدم اعتمادًا على الملف فقط.',
};

async function generateOperation(operationId: string) {
  const operation = await db.fileOperation.findUnique({ where: { id: operationId }, include: { file: true, user: true } });
  if (!operation) throw new Error('OPERATION_NOT_FOUND');
  await db.fileOperation.update({ where: { id: operation.id }, data: { status: 'RUNNING', startedAt: new Date(), progress: 10 } });
  const chunks = await db.fileChunk.findMany({ where: { fileId: operation.fileId }, orderBy: { chunkIndex: 'asc' }, select: { id: true, text: true, pageStart: true, pageEnd: true } });
  if (!chunks.length) throw new Error('FILE_NOT_READY');
  const question = operation.type === 'ASK_FILE' && typeof operation.parameters === 'object' && operation.parameters ? String((operation.parameters as { question?: unknown }).question ?? '') : '';
  const evidence = chunks.map(c => `[الصفحات ${c.pageStart ?? '?'}-${c.pageEnd ?? '?'}]\n${c.text}`).join('\n\n---\n\n').slice(0, 30_000);
  const prompt = `أنت QMRMed File AI. عالج الملف «${operation.file.originalName}». اعتمد حصريًا على الأدلة المرفقة. لا تضف معلومات طبية خارج الملف ولا تخمّن. إذا كانت المعلومة غير موجودة قل ذلك بوضوح.\n\nالمهمة: ${tasks[operation.type]}${question ? `\nسؤال المستخدم: ${question}` : ''}\n\nالأدلة:\n${evidence}`;
  const result = await routedChat('study', operation.user.plan, [{ role: 'system', content: 'QMRMed File AI: source-grounded medical education only.' }, { role: 'user', content: prompt }], 0.2);
  const resultId = randomUUID();
  await db.$transaction(async tx => {
    await tx.fileResult.create({ data: { id: resultId, operationId: operation.id, version: 1, title: labels[operation.type], content: result } });
    for (const chunk of chunks.slice(0, 50)) await tx.citation.create({ data: { id: randomUUID(), resultId, kind: 'FILE_CHUNK', chunkId: chunk.id, pageNumber: chunk.pageStart ?? undefined, locator: chunk.pageStart ? `pages:${chunk.pageStart}-${chunk.pageEnd ?? chunk.pageStart}` : undefined } });
    await tx.fileOperation.update({ where: { id: operation.id }, data: { status: 'COMPLETED', progress: 100, completedAt: new Date() } });
  });
  await telegramSend(operation.user.telegramId, `📄 ${labels[operation.type]} — «${operation.file.originalName}»\n\n${result}`, new InlineKeyboard().text('🔄 عملية أخرى', `filev3:file:${operation.fileId}`).row().text('📚 الأرشيف', `filev3:archive:${operation.fileId}`));
}

async function analyze(fileId: string) {
  const file = await db.file.findUnique({ where: { id: fileId }, include: { user: true } });
  if (!file) throw new Error('FILE_NOT_FOUND');
  const chunks = await db.fileChunk.findMany({ where: { fileId }, orderBy: { chunkIndex: 'asc' }, select: { text: true, pageStart: true, pageEnd: true } });
  const evidence = chunks.slice(0, 8).map(c => `[${c.pageStart ?? '?'}-${c.pageEnd ?? '?'}] ${c.text}`).join('\n').slice(0, 18_000);
  const summary = await routedChat('study', file.user.plan, [{ role: 'system', content: 'Create a concise grounded document summary from the supplied file evidence only.' }, { role: 'user', content: `File: ${file.originalName}\nEvidence:\n${evidence}` }], 0.1);
  await db.fileAnalysis.create({ data: { id: randomUUID(), fileId, version: 1, summary, documentMap: { pages: file.pageCount, chunks: chunks.length }, topicMap: {}, evidenceIndex: { groundedChunks: Math.min(chunks.length, 8) }, language: 'auto' } });
}

export async function processFileJob(job: { type: string; fileId: string; payload: unknown }) {
  if (job.type === 'FILE_INGESTION') return ingest({ fileId: job.fileId });
  if (job.type === 'FILE_ANALYSIS') return analyze(job.fileId);
  if (job.type === 'FILE_RESULT') {
    const payload = (job.payload ?? {}) as { operationId?: string };
    if (!payload.operationId) throw new Error('OPERATION_ID_REQUIRED');
    return generateOperation(payload.operationId);
  }
  throw new Error(`UNSUPPORTED_JOB_TYPE:${job.type}`);
}

async function getUser(ctx: Context) { if (!ctx.from) throw new Error('Missing Telegram user'); return upsertTelegramUser(ctx.from); }

async function queueOperation(ctx: Context, fileId: string, type: FileOperationType, parameters?: Record<string, unknown>) {
  const user = await getUser(ctx);
  const file = await db.file.findFirst({ where: { id: fileId, userId: user.id, status: 'READY' } });
  if (!file) return ctx.reply('⏳ الملف لم يجهز بعد أو لم يعد متاحًا.');
  const requestKey = type === 'ASK_FILE' ? `${fileId}:ASK_FILE:${randomUUID()}` : `${fileId}:${type}`;
  const operation = await db.fileOperation.create({ data: { id: randomUUID(), userId: user.id, fileId, type, requestKey, parameters, status: 'QUEUED' } });
  const job = await enqueueJob({ userId: user.id, type: 'FILE_RESULT', fileId, idempotencyKey: `result:${operation.id}`, payload: { operationId: operation.id } });
  await db.fileOperation.update({ where: { id: operation.id }, data: { jobId: job.id } });
  return ctx.reply(`⏳ تم وضع «${labels[type]}» في قائمة المعالجة.\nالحالة: QUEUED\nالنتيجة ستُحفظ في قاعدة البيانات.`, { reply_markup: new InlineKeyboard().text('⬅️ الملف', `filev3:file:${fileId}`) });
}

export function registerFileAiV3Handlers(bot: Bot) {
  bot.on('message:document', async ctx => {
    const doc = ctx.message.document;
    if (!doc.file_size || doc.file_size > MAX_FILE_BYTES) return ctx.reply('⚠️ حجم الملف يتجاوز الحد المدعوم (20 MB).');
    const user = await getUser(ctx);
    const existing = await db.file.findFirst({ where: { userId: user.id, storageKey: doc.file_id, status: { not: 'DELETED' } } });
    if (existing) return ctx.reply('📄 هذا الملف موجود مسبقًا.', { reply_markup: mainMenu(existing.id) });
    const placeholder = createHash('sha256').update(`telegram:${doc.file_id}`).digest('hex');
    const file = await db.file.create({ data: { id: randomUUID(), userId: user.id, originalName: (doc.file_name ?? 'qmrmed-file').slice(0, 500), mimeType: doc.mime_type ?? 'application/octet-stream', sizeBytes: BigInt(doc.file_size), sha256: placeholder, storageKey: doc.file_id, status: 'RECEIVED' } });
    await enqueueJob({ userId: user.id, type: 'FILE_INGESTION', fileId: file.id, idempotencyKey: `ingest:${file.id}`, payload: { fileId: file.id } });
    return ctx.reply(`📄 استلمت الملف: ${file.originalName}\n\n🔒 الحالة: RECEIVED → QUEUED\nالمعالجة تتم بالخلفية مع حفظ الحالة والنتائج في PostgreSQL.`, { reply_markup: new InlineKeyboard().text('🔄 تحديث الحالة', `filev3:status:${file.id}`) });
  });
  bot.callbackQuery(/^filev3:group:([^:]+):([^:]+)$/, async ctx => { await ctx.answerCallbackQuery(); return ctx.editMessageText('📄 اختر العملية:', { reply_markup: groupMenu(ctx.match[1], ctx.match[2]) }); });
  bot.callbackQuery(/^filev3:file:([^:]+)$/, async ctx => { await ctx.answerCallbackQuery(); return ctx.editMessageText('📄 ماذا تريد أن تفعل بالملف؟', { reply_markup: mainMenu(ctx.match[1]) }); });
  bot.callbackQuery(/^filev3:op:([^:]+):([A-Z_]+)$/, async ctx => { await ctx.answerCallbackQuery('تمت الإضافة إلى قائمة المعالجة'); return queueOperation(ctx, ctx.match[1], ctx.match[2] as FileOperationType); });
  bot.callbackQuery(/^filev3:ask:([^:]+)$/, async ctx => { await ctx.answerCallbackQuery(); return ctx.reply('🔎 أرسل الآن سؤالك عن هذا الملف في رسالة واحدة.', { reply_markup: new InlineKeyboard().text('إلغاء', `filev3:file:${ctx.match[1]}`) }); });
  bot.on('message:text', async ctx => {
    const user = await getUser(ctx);
    const pending = await db.fileOperation.findFirst({ where: { userId: user.id, type: 'ASK_FILE', status: 'QUEUED', parameters: { path: ['awaitingQuestion'], equals: true } }, orderBy: { createdAt: 'desc' } });
    if (!pending) return;
    return queueOperation(ctx, pending.fileId, 'ASK_FILE', { question: ctx.message.text });
  });
  bot.callbackQuery(/^filev3:status:([^:]+)$/, async ctx => { await ctx.answerCallbackQuery(); const file = await db.file.findUnique({ where: { id: ctx.match[1] }, select: { originalName: true, status: true, pageCount: true, extractedChars: true } }); if (!file) return ctx.editMessageText('الملف غير موجود.'); return ctx.editMessageText(`📄 ${file.originalName}\n\nالحالة: ${file.status}\nالصفحات: ${file.pageCount ?? '-'}\nالنص المستخرج: ${file.extractedChars.toLocaleString()} حرف`, { reply_markup: new InlineKeyboard().text('🔄 تحديث', `filev3:status:${ctx.match[1]}`).row().text('⬅️ الملف', `filev3:file:${ctx.match[1]}`) }); });
  bot.callbackQuery(/^filev3:archive:([^:]+)$/, async ctx => { await ctx.answerCallbackQuery(); const user = await getUser(ctx); const rows = await db.fileResult.findMany({ where: { operation: { userId: user.id, fileId: ctx.match[1] } }, include: { operation: true }, orderBy: { createdAt: 'desc' }, take: 8 }); const text = rows.length ? rows.map((r, i) => `${i + 1}. ${r.title} — ${r.createdAt.toLocaleString('ar-IQ')}`).join('\n') : 'لا توجد نتائج محفوظة بعد.'; return ctx.editMessageText(`📚 أرشيف الملف\n\n${text}`, { reply_markup: new InlineKeyboard().text('⬅️ الملف', `filev3:file:${ctx.match[1]}`) }); });
}
