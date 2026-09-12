import { PrismaClient } from '@prisma/client';
import { publishAiJob } from './vercel-queue.js';

export const db = new PrismaClient().$extends({
  query: {
    aIJob: {
      async create({ args, query }) {
        const job = await query(args);
        await publishAiJob(job.id, job.idempotencyKey);
        return job;
      },
    },
  },
});

export async function upsertTelegramUser(from: { id: number; username?: string; first_name?: string; last_name?: string }) {
  return db.user.upsert({
    where: { telegramId: String(from.id) },
    create: { telegramId: String(from.id), username: from.username, firstName: from.first_name, lastName: from.last_name },
    update: { username: from.username, firstName: from.first_name, lastName: from.last_name },
  });
}
