import { PrismaClient } from '@prisma/client';
import { startFileAiArchiveSync } from './file-ai-archive.js';

export const db = new PrismaClient();

export async function upsertTelegramUser(from: { id: number; username?: string; first_name?: string; last_name?: string }) {
  return db.user.upsert({
    where: { telegramId: String(from.id) },
    create: { telegramId: String(from.id), username: from.username, firstName: from.first_name, lastName: from.last_name },
    update: { username: from.username, firstName: from.first_name, lastName: from.last_name },
  });
}

// File AI still writes its local JSON archive for backward compatibility and PDF workflows.
// This background synchronizer makes PostgreSQL the durable production archive without changing
// the existing File AI generation path or risking a breaking rewrite of that module.
startFileAiArchiveSync(db);
