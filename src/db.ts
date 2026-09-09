import { PrismaClient } from '@prisma/client';

export const db = new PrismaClient();

export async function upsertTelegramUser(from: { id: number; username?: string; first_name?: string; last_name?: string }) {
  return db.user.upsert({
    where: { telegramId: String(from.id) },
    create: {
      telegramId: String(from.id),
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    },
    update: {
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    },
  });
}
