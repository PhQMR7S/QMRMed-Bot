import { claimNextJob, completeJob, failJob } from './ai-jobs.js';
import { db } from './db.js';
import { processFileJob } from './file-ai-v4.js';

export async function processNextAiJob(workerId: string) {
  const job = await claimNextJob(workerId);
  if (!job) return { processed: false as const };

  try {
    await processFileJob({ type: job.type, fileId: job.fileId ?? '', payload: job.payload });
    await completeJob(job.id, workerId, { ok: true });
    return { processed: true as const, jobId: job.id, type: job.type };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const willRetry = job.attempts < job.maxAttempts;
    await failJob(job.id, workerId, 'WORKER_ERROR', message, true);

    if (!willRetry && job.fileId) {
      await db.file.updateMany({
        where: { id: job.fileId, status: { not: 'DELETED' } },
        data: { status: 'FAILED', errorCode: 'WORKER_ERROR', errorMessage: message.slice(0, 2000) },
      });
    }

    if (!willRetry && job.type === 'FILE_RESULT' && typeof job.payload === 'object' && job.payload && 'operationId' in job.payload) {
      const operationId = String((job.payload as { operationId?: unknown }).operationId ?? '');
      if (operationId) {
        await db.fileOperation.updateMany({
          where: { id: operationId, status: { in: ['QUEUED', 'RUNNING'] } },
          data: { status: 'FAILED', errorCode: 'WORKER_ERROR', errorMessage: message.slice(0, 2000), completedAt: new Date() },
        });
      }
    }

    if (willRetry) throw error;
    return { processed: true as const, jobId: job.id, type: job.type, failed: true as const };
  }
}
