import { randomUUID } from 'node:crypto';
import type { FileOperationType, Prisma } from '@prisma/client';
import { db } from './db.js';
import { enqueueJob } from './ai-jobs.js';
import { routedChat } from './ai-routing.js';

const REDUCE_FAN_IN = 6;
const MAP_MAX_OUTPUT = 1800;
const BATCH_MAX_OUTPUT = 2600;
const TG_LIMIT = 3900;

const labels: Record<FileOperationType, string> = {
  EXPLAIN: 'شرح', SUMMARY: 'تلخيص', QA: 'أسئلة وأجوبة', MCQ: 'MCQ', TRUE_FALSE: 'صح/خطأ', FILL_BLANK: 'أكمل الفراغ', MATCHING: 'مطابقة', CASES: 'حالات سريرية', VIVA: 'Viva', MIND_MAP: 'خريطة ذهنية', FLOWCHART: 'مخطط انسيابي', COMPARISON: 'مقارنة', TIMELINE: 'خط زمني', DIAGNOSTIC: 'خوارزمية تشخيصية', EXAM: 'اختبار تجريبي', ASK_FILE: 'اسأل الملف',
};

const tasks: Record<FileOperationType, string> = {
  EXPLAIN: 'اشرح المحتوى أكاديميًا وبشكل منظم.',
  SUMMARY: 'أنشئ ملخصًا عالي العائد يغطي كامل الملف.',
  QA: 'أنشئ أسئلة وأجوبة تغطي أهم المعلومات في كامل الملف.',
  MCQ: 'أنشئ 20 MCQ بأربعة خيارات مع الإجابة والتفسير.',
  TRUE_FALSE: 'أنشئ 20 صح/خطأ مع الإجابة والتفسير.',
  FILL_BLANK: 'أنشئ 20 أكمل الفراغ مع الإجابة.',
  MATCHING: 'أنشئ أسئلة مطابقة مع مفتاح الإجابة.',
  CASES: 'أنشئ 8 حالات سريرية تعليمية مبنية فقط على الملف.',
  VIVA: 'أنشئ أسئلة Viva مع إجابات نموذجية.',
  MIND_MAP: 'حوّل المحتوى إلى خريطة ذهنية هرمية.',
  FLOWCHART: 'حوّل الخوارزميات إلى مخطط انسيابي نصي.',
  COMPARISON: 'استخرج أهم المقارنات في الملف.',
  TIMELINE: 'استخرج التسلسل الزمني أو المراحل.',
  DIAGNOSTIC: 'أنشئ خوارزمية تشخيصية من الملف فقط.',
  EXAM: 'أنشئ اختبارًا تجريبيًا من 30 سؤالًا مع مفتاح الإجابة والتفسير.',
  ASK_FILE: 'أجب عن سؤال المستخدم اعتمادًا على الملف فقط.',
};

type PipelinePayload = {
  stage?: 'plan' | 'map' | 'reduce';
  operationId?: string;
  chunkId?: string;
  sourceJobIds?: string[];
  kind?: 'analysis' | 'result';
  question?: string;
};

type PipelineJob = { id: string; type: string; fileId: string; payload: unknown };

function clip(text: string, max: number) { return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
function chunksForTelegram(text: string) {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > TG_LIMIT) {
    let cut = Math.max(rest.lastIndexOf('\n', TG_LIMIT), rest.lastIndexOf(' '));
    if (cut < TG_LIMIT * 0.6) cut = TG_LIMIT;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out.length ? out : [''];
}
async function sendTelegram(chatId: string, text: string) {
  for (const part of chunksForTelegram(text)) {
    const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: part }) });
    if (!response.ok) console.warn(JSON.stringify({ event: 'file_ai_telegram_send_failed', status: response.status }));
  }
}

function groups<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function createTree(userId: number, fileId: string, type: 'FILE_ANALYSIS' | 'FILE_RESULT', kind: 'analysis' | 'result', sourceIds: string[], payloadBase: PipelinePayload) {
  let level = await Promise.all(sourceIds.map(async (sourceId) => enqueueJob({ userId, type, fileId, idempotencyKey: `${kind}:map:${payloadBase.operationId ?? fileId}:${sourceId}`, payload: { ...payloadBase, stage: 'map', kind, chunkId: sourceId } })));
  let ids = level.map(job => job.id);
  if (!ids.length) throw new Error('PIPELINE_NO_INPUTS');

  while (ids.length > 1) {
    const next: string[] = [];
    for (const sourceJobIds of groups(ids, REDUCE_FAN_IN)) {
      const job = await enqueueJob({
        userId, type, fileId,
        idempotencyKey: `${kind}:reduce:${payloadBase.operationId ?? fileId}:${sourceJobIds.join('.')}`,
        payload: { ...payloadBase, stage: 'reduce', kind, sourceJobIds },
      });
      next.push(job.id);
    }
    ids = next;
  }
  return ids[0];
}

async function updateOperationProgress(operationId: string, base = 10) {
  const [total, done] = await Promise.all([
    db.aIJob.count({ where: { type: 'FILE_RESULT', payload: { path: ['operationId'], equals: operationId } } }),
    db.aIJob.count({ where: { type: 'FILE_RESULT', status: 'COMPLETED', payload: { path: ['operationId'], equals: operationId } } }),
  ]).catch(() => [0, 0] as const);
  if (total > 0) await db.fileOperation.updateMany({ where: { id: operationId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { progress: Math.min(99, Math.max(base, Math.round((done / total) * 100))) } });
}

async function mapAnalysis(fileId: string, chunkId: string, jobId: string) {
  const chunk = await db.fileChunk.findUnique({ where: { id: chunkId }, select: { text: true, pageStart: true, pageEnd: true } });
  if (!chunk) throw new Error('CHUNK_NOT_FOUND');
  const result = await routedChat('study', 'FREE', [
    { role: 'system', content: 'QMRMed Document Intelligence. Extract only facts explicitly supported by this document chunk. Be concise. Preserve medical terminology and page range.' },
    { role: 'user', content: `Pages ${chunk.pageStart ?? '?'}-${chunk.pageEnd ?? '?'}\nExtract: key concepts, definitions, classifications, mechanisms, clinical points, formulas, tables, algorithms, and high-yield exam facts. Do not invent missing information.\n\n${chunk.text}` },
  ], 0.1);
  await db.aIJob.updateMany({ where: { id: jobId }, data: { result: { text: clip(result, MAP_MAX_OUTPUT), pageStart: chunk.pageStart, pageEnd: chunk.pageEnd }, progress: 100, stage: 'MAP_COMPLETE' } });
  return result;
}

async function mapResult(operationId: string, chunkId: string, jobId: string) {
  const [op, chunk] = await Promise.all([
    db.fileOperation.findUnique({ where: { id: operationId }, include: { file: true, user: true } }),
    db.fileChunk.findUnique({ where: { id: chunkId }, select: { text: true, pageStart: true, pageEnd: true } }),
  ]);
  if (!op || !chunk) throw new Error('PIPELINE_INPUT_NOT_FOUND');
  const question = typeof op.parameters === 'object' && op.parameters ? String((op.parameters as { question?: unknown }).question ?? '') : '';
  const result = await routedChat('study', op.user.plan, [
    { role: 'system', content: 'QMRMed File AI. Work only from the supplied document chunk. Do not invent facts. Produce useful candidate material that can be merged later. Preserve page references.' },
    { role: 'user', content: `Task: ${tasks[op.type]}\n${question ? `User question: ${question}\n` : ''}Pages ${chunk.pageStart ?? '?'}-${chunk.pageEnd ?? '?'}\n\n${chunk.text}` },
  ], 0.15);
  await db.aIJob.updateMany({ where: { id: jobId }, data: { result: { text: clip(result, MAP_MAX_OUTPUT), pageStart: chunk.pageStart, pageEnd: chunk.pageEnd }, progress: 100, stage: 'MAP_COMPLETE' } });
  return result;
}

async function reduceJob(job: PipelineJob, payload: PipelinePayload) {
  const sourceIds = payload.sourceJobIds ?? [];
  if (!sourceIds.length) throw new Error('PIPELINE_NO_SOURCES');
  const sources = await db.aIJob.findMany({ where: { id: { in: sourceIds } }, select: { id: true, status: true, result: true, errorMessage: true } });
  if (sources.length !== sourceIds.length) return { defer: true };
  if (sources.some(source => source.status === 'FAILED' || source.status === 'CANCELLED')) throw new Error('PIPELINE_SOURCE_FAILED');
  if (sources.some(source => source.status !== 'COMPLETED')) return { defer: true };

  const evidence = sources.map((source, index) => {
    const result = source.result && typeof source.result === 'object' ? source.result as { text?: unknown; pageStart?: unknown; pageEnd?: unknown } : {};
    return `[المصدر ${index + 1} | الصفحات ${result.pageStart ?? '?'}-${result.pageEnd ?? '?'}]\n${String(result.text ?? '')}`;
  }).join('\n\n---\n\n');

  if (payload.kind === 'analysis') {
    const result = await routedChat('study', 'FREE', [
      { role: 'system', content: 'QMRMed Document Intelligence reducer. Merge the supplied extracted facts without adding outside knowledge. Produce a compact, structured knowledge representation for the next reduction layer.' },
      { role: 'user', content: `Merge these document evidence units into a coherent section map. Keep important distinctions, definitions, mechanisms, clinical facts, algorithms, and exam points.\n\n${clip(evidence, 24000)}` },
    ], 0.1);
    await db.aIJob.updateMany({ where: { id: job.id }, data: { result: { text: clip(result, BATCH_MAX_OUTPUT) }, progress: 100, stage: 'REDUCE_COMPLETE' } });
    return { result };
  }

  const operation = payload.operationId ? await db.fileOperation.findUnique({ where: { id: payload.operationId }, include: { file: true, user: true } }) : null;
  if (!operation) throw new Error('OPERATION_NOT_FOUND');
  const result = await routedChat('study', operation.user.plan, [
    { role: 'system', content: 'QMRMed File AI reducer. Merge candidate material from the document only. Preserve factual fidelity and remove duplication. Do not add outside medical knowledge.' },
    { role: 'user', content: `Task: ${tasks[operation.type]}\n${clip(evidence, 24000)}` },
  ], 0.15);
  await db.aIJob.updateMany({ where: { id: job.id }, data: { result: { text: clip(result, BATCH_MAX_OUTPUT) }, progress: 100, stage: 'REDUCE_COMPLETE' } });
  return { result };
}

async function planAnalysis(job: PipelineJob) {
  const file = await db.file.findUnique({ where: { id: job.fileId }, select: { userId: true } });
  if (!file) throw new Error('FILE_NOT_FOUND');
  const chunks = await db.fileChunk.findMany({ where: { fileId: job.fileId }, orderBy: { chunkIndex: 'asc' }, select: { id: true } });
  const rootId = await createTree(file.userId, job.fileId, 'FILE_ANALYSIS', 'analysis', chunks.map(chunk => chunk.id), {});
  await db.aIJob.updateMany({ where: { id: job.id }, data: { result: { rootJobId: rootId, chunks: chunks.length }, progress: 100, stage: 'TREE_CREATED' } });
  return { rootId };
}

async function planResult(job: PipelineJob, operationId: string) {
  const operation = await db.fileOperation.findUnique({ where: { id: operationId }, include: { file: true } });
  if (!operation) throw new Error('OPERATION_NOT_FOUND');
  await db.fileOperation.updateMany({ where: { id: operationId, status: 'QUEUED' }, data: { status: 'RUNNING', progress: 5, startedAt: new Date(), errorCode: null, errorMessage: null } });
  const chunks = await db.fileChunk.findMany({ where: { fileId: operation.fileId }, orderBy: { chunkIndex: 'asc' }, select: { id: true } });
  const rootId = await createTree(operation.userId, operation.fileId, 'FILE_RESULT', 'result', chunks.map(chunk => chunk.id), { operationId });
  await db.fileOperation.updateMany({ where: { id: operationId }, data: { jobId: job.id, progress: 10 } });
  await db.aIJob.updateMany({ where: { id: job.id }, data: { result: { rootJobId: rootId, chunks: chunks.length }, progress: 100, stage: 'TREE_CREATED' } });
  return { rootId };
}

async function finalAnalysis(job: PipelineJob, payload: PipelinePayload) {
  const sources = await db.aIJob.findMany({ where: { id: { in: payload.sourceJobIds ?? [] }, status: 'COMPLETED' }, select: { result: true } });
  const evidence = sources.map(source => source.result && typeof source.result === 'object' ? String((source.result as { text?: unknown }).text ?? '') : '').filter(Boolean).join('\n\n---\n\n');
  const file = await db.file.findUnique({ where: { id: job.fileId }, select: { pageCount: true } });
  const summary = await routedChat('study', 'FREE', [
    { role: 'system', content: 'QMRMed final document intelligence. Create a compact, comprehensive high-yield knowledge map from the supplied reduced evidence only. Do not introduce outside facts.' },
    { role: 'user', content: `Pages: ${file?.pageCount ?? '?'}\n\n${clip(evidence, 28000)}` },
  ], 0.1);
  const existing = await db.fileAnalysis.findFirst({ where: { fileId: job.fileId }, orderBy: { version: 'desc' }, select: { version: true } });
  const version = (existing?.version ?? 0) + 1;
  await db.fileAnalysis.create({ data: { id: randomUUID(), fileId: job.fileId, version, summary, documentMap: { pages: file?.pageCount ?? null, pipeline: 'map-reduce-tree' }, topicMap: { generated: true }, evidenceIndex: { sourceJobs: payload.sourceJobIds ?? [] }, language: 'auto' } });
  await db.aIJob.updateMany({ where: { id: job.id }, data: { result: { version, summary: clip(summary, 6000) }, progress: 100, stage: 'ANALYSIS_COMPLETE' } });
}

async function finalResult(job: PipelineJob, payload: PipelinePayload) {
  const operation = payload.operationId ? await db.fileOperation.findUnique({ where: { id: payload.operationId }, include: { file: true, user: true } }) : null;
  if (!operation) throw new Error('OPERATION_NOT_FOUND');
  const sources = await db.aIJob.findMany({ where: { id: { in: payload.sourceJobIds ?? [] }, status: 'COMPLETED' }, select: { result: true } });
  const evidence = sources.map(source => source.result && typeof source.result === 'object' ? String((source.result as { text?: unknown }).text ?? '') : '').filter(Boolean).join('\n\n---\n\n');
  const question = typeof operation.parameters === 'object' && operation.parameters ? String((operation.parameters as { question?: unknown }).question ?? '') : '';
  const final = await routedChat('study', operation.user.plan, [
    { role: 'system', content: 'QMRMed File AI final synthesis. Use only the supplied reduced evidence from the uploaded file. Do not add outside medical facts. Keep the answer academically structured, precise, and concise. For generated questions/cases, ensure every item is supported by the source evidence.' },
    { role: 'user', content: `Task: ${tasks[operation.type]}\n${question ? `User question: ${question}\n` : ''}\nREDUCED EVIDENCE:\n${clip(evidence, 30000)}` },
  ], 0.1);
  const resultId = randomUUID();
  const chunks = await db.fileChunk.findMany({ where: { fileId: operation.fileId }, orderBy: { chunkIndex: 'asc' }, select: { id: true, pageStart: true, pageEnd: true } });
  await db.$transaction(async tx => {
    await tx.fileResult.create({ data: { id: resultId, operationId: operation.id, version: 1, title: labels[operation.type], content: final } });
    for (const chunk of chunks) await tx.citation.create({ data: { id: randomUUID(), resultId, kind: 'FILE_CHUNK', chunkId: chunk.id, pageNumber: chunk.pageStart ?? undefined, locator: chunk.pageStart ? `pages:${chunk.pageStart}-${chunk.pageEnd ?? chunk.pageStart}` : undefined } });
    await tx.fileOperation.update({ where: { id: operation.id }, data: { status: 'COMPLETED', progress: 100, completedAt: new Date(), errorCode: null, errorMessage: null } });
    await tx.aIJob.updateMany({ where: { id: job.id }, data: { result: { resultId }, progress: 100, stage: 'RESULT_COMPLETE' } });
  });
  await sendTelegram(operation.user.telegramId, `📄 ${labels[operation.type]}\n\n${final}`);
}

export async function processFilePipelineJob(job: PipelineJob) {
  const payload = (job.payload ?? {}) as PipelinePayload;
  if (job.type === 'FILE_ANALYSIS') {
    if (payload.stage === 'plan') return planAnalysis(job);
    if (payload.stage === 'map' && payload.chunkId) return mapAnalysis(job.fileId, payload.chunkId, job.id);
    if (payload.stage === 'reduce') {
      const result = await reduceJob(job, payload);
      if ((result as { defer?: boolean }).defer) return result;
      const sourceIds = payload.sourceJobIds ?? [];
      const childCount = await db.aIJob.count({ where: { fileId: job.fileId, type: 'FILE_ANALYSIS', status: 'COMPLETED' } });
      if (childCount > 0 && sourceIds.length === childCount) return finalAnalysis(job, payload);
      return result;
    }
  }
  if (job.type === 'FILE_RESULT') {
    if (payload.stage === 'plan' && payload.operationId) return planResult(job, payload.operationId);
    if (payload.stage === 'map' && payload.chunkId && payload.operationId) return mapResult(payload.operationId, payload.chunkId, job.id);
    if (payload.stage === 'reduce') {
      const result = await reduceJob(job, payload);
      if ((result as { defer?: boolean }).defer) return result;
      const sourceIds = payload.sourceJobIds ?? [];
      const operationId = payload.operationId;
      if (!operationId) throw new Error('OPERATION_ID_REQUIRED');
      const operation = await db.fileOperation.findUnique({ where: { id: operationId }, select: { fileId: true } });
      if (!operation) throw new Error('OPERATION_NOT_FOUND');
      const completed = await db.aIJob.count({ where: { fileId: operation.fileId, type: 'FILE_RESULT', status: 'COMPLETED', payload: { path: ['operationId'], equals: operationId } } }).catch(() => 0);
      if (completed >= sourceIds.length) return finalResult(job, payload);
      return result;
    }
  }
  throw new Error(`UNSUPPORTED_PIPELINE_STAGE:${job.type}:${payload.stage ?? 'none'}`);
}

export function operationTaskLabel(type: FileOperationType) { return labels[type]; }
export function pipelineTaskText(type: FileOperationType) { return tasks[type]; }
