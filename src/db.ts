import { PrismaClient } from '@prisma/client';
import { publishAiJob } from './vercel-queue.js';

const nativeFetch = globalThis.fetch.bind(globalThis);
let telegramFileFetchInstalled = false;

function installTelegramFileFetchAdapter() {
  if (telegramFileFetchInstalled) return;
  telegramFileFetchInstalled = true;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const match = url.match(/^https:\/\/api\.telegram\.org\/file\/bot([^/]+)\/(.+)$/);
    if (!match) return nativeFetch(input, init);

    const botToken = match[1];
    const fileId = decodeURIComponent(match[2]);
    const lookup = await nativeFetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const payload = await lookup.json() as { ok?: boolean; result?: { file_path?: string }; description?: string };
    if (!lookup.ok || !payload.ok || !payload.result?.file_path) {
      throw new Error(`TELEGRAM_GET_FILE_FAILED:${payload.description ?? lookup.status}`);
    }

    return nativeFetch(`https://api.telegram.org/file/bot${botToken}/${payload.result.file_path}`, init);
  };
}

installTelegramFileFetchAdapter();

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
