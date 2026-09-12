import { claimNextJob, completeJob, deferJob, failJob } from './ai-jobs.js';
import { db } from './db.js';
import { processFilePipelineJob } from './file-ai-pipeline-v2.js';

export async function processNextAiJob(workerId: string) {
  const job = await claimNextJob(workerId);
  if (!job) return { processed: false as const };

  try {
    const result = await processFilePipelineJob({ id: job.id, type: job.type, fileId: job.fileId ?? '', payload: job.payload });
    if (result && typeof result === 'object' && 'defer' in result && result.defer) {
      await deferJob(job.id, workerId, 5);
      throw new Error('PIPELINE_WAITING_FOR_CHILDREN');
    }
    await completeJob(job.id, workerId, result && typeof result === 'object' ? result as any : { ok: true });
    return { processed: true as const, jobId: job.id, type: job.type };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const waiting = message === 'PIPELINE_WAITING_FOR_CHILDREN';
    if (waiting) return Promise.reject(error);
    const willRetry = job.attempts < job.maxAttempts;
    await failJob(job.id, workerId, 'WORKER_ERROR', message, true);

    // Only the ingestion stage may invalidate the file itself. Analysis/result
    // failures are isolated to their jobs and operations.
    if (!willRetry && job.fileId && job.type === 'FILE_INGESTION') {
      await db.file.updateMany({ where: { id: job.fileId, status: { not: 'DELETED' } }, data: { status: 'FAILED', errorCode: 'WORKER_ERROR', errorMessage: message.slice(0, 2000) } });
    }
    if (!willRetry && job.type === 'FILE_RESULT' && typeof job.payload === 'object' && job.payload && 'operationId' in job.payload) {
      const operationId = String((job.payload as { operationId?: unknown }).operationId ?? '');
      if (operationId) await db.fileOperation.updateMany({ where: { id: operationId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', errorCode: 'WORKER_ERROR', errorMessage: message.slice(0, 2000), completedAt: new Date() } });
    }
    if (willRetry) throw error;
    return { processed: true as const, jobId: job.id, type: job.type, failed: true as const };
  }
}
