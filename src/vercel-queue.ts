import { send } from '@vercel/queue';

export const AI_QUEUE_TOPIC = 'qmrmed-ai';

export async function publishAiJob(jobId: string, idempotencyKey: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await send(AI_QUEUE_TOPIC, { jobId }, {
        idempotencyKey: `ai-job:${idempotencyKey}`,
        retentionSeconds: 86_400,
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
