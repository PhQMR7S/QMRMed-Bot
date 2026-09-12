import { claimNextJob, completeJob, failJob } from '../src/ai-jobs.js';
import { processFileJob } from '../src/file-ai-v4.js';
import { db } from '../src/db.js';

export const maxDuration = 300;

function authorized(req: any) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return String(req.headers?.authorization ?? '') === `Bearer ${secret}`;
}

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const workerId = `vercel:${process.env.VERCEL_REGION ?? 'unknown'}:${process.pid}`;
  const job = await claimNextJob(workerId);
  if (!job) return res.status(200).json({ ok: true, processed: false, message: 'NO_JOB' });
  try {
    await processFileJob({ type: job.type, fileId: job.fileId ?? '', payload: job.payload });
    await completeJob(job.id, workerId, { ok: true });
    return res.status(200).json({ ok: true, processed: true, jobId: job.id, type: job.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const willRetry = job.attempts < job.maxAttempts;
    await failJob(job.id, workerId, 'WORKER_ERROR', message, true);
    if (!willRetry && job.fileId && job.type === 'FILE_INGESTION') {
      await db.file.updateMany({ where: { id: job.fileId, status: { not: 'DELETED' } }, data: { status: 'FAILED', errorCode: 'WORKER_ERROR', errorMessage: message.slice(0, 2000) } });
    }
    if (!willRetry && job.type === 'FILE_RESULT' && typeof job.payload === 'object' && job.payload && 'operationId' in job.payload) {
      const operationId = String((job.payload as { operationId?: unknown }).operationId ?? '');
      if (operationId) await db.fileOperation.updateMany({ where: { id: operationId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', errorCode: 'WORKER_ERROR', errorMessage: message.slice(0, 2000), completedAt: new Date() } });
    }
    return res.status(500).json({ ok: false, processed: true, jobId: job.id, error: message, willRetry });
  }
}
