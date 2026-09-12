import { QueueClient } from '@vercel/queue';
import { processNextAiJob } from '../src/ai-queue-worker.js';

export const maxDuration = 300;

const queue = new QueueClient();
const { handleNodeCallback } = queue;

type QueueMessage = { jobId?: string };

export default handleNodeCallback<QueueMessage>(
  async (_message, metadata) => {
    const workerId = `queue:${metadata.consumerGroup}:${metadata.messageId}:${process.env.VERCEL_REGION ?? 'unknown'}`;
    await processNextAiJob(workerId);
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (_error, metadata) => ({ afterSeconds: Math.min(300, 5 * 2 ** Math.max(0, metadata.deliveryCount - 1)) }),
  },
);
