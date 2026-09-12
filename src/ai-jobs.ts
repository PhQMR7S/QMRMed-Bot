import { randomUUID } from 'node:crypto';
import type { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { db } from './db.js';

export const JOB_LEASE_MS = 60_000;

export type EnqueueJobInput = {
  userId: number;
  type: AIJobType;
  idempotencyKey: string;
  fileId?: string;
  analysisId?: string;
  payload?: Prisma.InputJsonValue;
  maxAttempts?: number;
  availableAt?: Date;
};

export async function enqueueJob(input: EnqueueJobInput) {
  const existing = await db.aIJob.findUnique({
    where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return existing;

  return db.aIJob.create({
    data: {
      id: randomUUID(),
      userId: input.userId,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      fileId: input.fileId,
      analysisId: input.analysisId,
      payload: input.payload,
      maxAttempts: input.maxAttempts ?? 3,
      availableAt: input.availableAt ?? new Date(),
    },
  });
}

export async function claimNextJob(workerId: string, now = new Date()) {
  const staleBefore = new Date(now.getTime() - JOB_LEASE_MS);
  const candidate = await db.aIJob.findFirst({
    where: {
      OR: [
        { status: 'QUEUED', availableAt: { lte: now } },
        { status: 'RUNNING', heartbeatAt: { lt: staleBefore } },
      ],
      attempts: { lt: 3 },
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
  });
  if (!candidate) return null;

  const claimed = await db.aIJob.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: 'QUEUED', availableAt: { lte: now } },
        { status: 'RUNNING', heartbeatAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: 'RUNNING',
      lockedBy: workerId,
      lockedAt: now,
      heartbeatAt: now,
      startedAt: candidate.startedAt ?? now,
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
    },
  });
  if (claimed.count !== 1) return null;
  return db.aIJob.findUnique({ where: { id: candidate.id } });
}

export async function heartbeatJob(jobId: string, workerId: string, progress?: number, stage?: string) {
  return db.aIJob.updateMany({
    where: { id: jobId, status: 'RUNNING', lockedBy: workerId },
    data: {
      heartbeatAt: new Date(),
      ...(progress === undefined ? {} : { progress: Math.max(0, Math.min(100, progress)) }),
      ...(stage === undefined ? {} : { stage }),
    },
  });
}

export async function completeJob(jobId: string, workerId: string, result?: Prisma.InputJsonValue) {
  return db.aIJob.updateMany({
    where: { id: jobId, status: 'RUNNING', lockedBy: workerId },
    data: { status: 'COMPLETED', progress: 100, result, completedAt: new Date(), heartbeatAt: null },
  });
}

export async function failJob(jobId: string, workerId: string, errorCode: string, errorMessage: string, retry = true) {
  const job = await db.aIJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'RUNNING' || job.lockedBy !== workerId) return 0;
  const shouldRetry = retry && job.attempts < job.maxAttempts;
  return db.aIJob.updateMany({
    where: { id: jobId, status: 'RUNNING', lockedBy: workerId },
    data: {
      status: shouldRetry ? 'QUEUED' : 'FAILED',
      errorCode,
      errorMessage: errorMessage.slice(0, 2000),
      availableAt: shouldRetry ? new Date(Date.now() + Math.min(60_000, 2 ** job.attempts * 1000)) : job.availableAt,
      lockedBy: null,
      lockedAt: null,
      heartbeatAt: null,
      ...(shouldRetry ? {} : { completedAt: new Date() }),
    },
  });
}

export async function cancelJob(jobId: string, userId: number) {
  return db.aIJob.updateMany({
    where: { id: jobId, userId, status: { in: ['QUEUED', 'RUNNING'] } },
    data: { status: 'CANCELLED', completedAt: new Date(), lockedBy: null, lockedAt: null, heartbeatAt: null },
  });
}

export function isTerminalJobStatus(status: AIJobStatus) {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}
