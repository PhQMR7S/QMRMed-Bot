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

// Keep the existing local archive as the compatibility/PDF layer while asynchronously
// mirroring completed records into PostgreSQL for durable production storage.
if (!process.argv.includes('--test') && process.env.QMRMED_DISABLE_ARCHIVE_SYNC !== '1') startFileAiArchiveSync(db);
