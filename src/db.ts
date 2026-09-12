import { PrismaClient } from '@prisma/client';
import { publishAiJob } from './vercel-queue.js';

const prisma = new PrismaClient();
const originalCreateAiJob = prisma.aIJob.create.bind(prisma.aIJob);
(prisma.aIJob as any).create = async (args: any) => {
  const job = await originalCreateAiJob(args);
  await publishAiJob(job.id, job.idempotencyKey);
  return job;
};

export const db = prisma;

export async function upsertTelegramUser(from: { id: number; username?: string; first_name?: string; last_name?: string }) {
  return db.user.upsert({
    where: { telegramId: String(from.id) },
    create: { telegramId: String(from.id), username: from.username, firstName: from.first_name, lastName: from.last_name },
    update: { username: from.username, firstName: from.first_name, lastName: from.last_name },
  });
}
