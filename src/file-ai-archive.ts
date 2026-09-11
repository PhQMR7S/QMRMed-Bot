import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';

export type PersistableFileAiArchive = {
  id: string;
  userId: string;
  sourceName: string;
  mimeType: string;
  operation: string;
  createdAt: string;
  text: string;
  result: string;
};

const ARCHIVE_ROOT = join(process.cwd(), '.qmrmed', 'file-ai');
let syncRunning = false;

function validItem(value: unknown): value is PersistableFileAiArchive {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PersistableFileAiArchive>;
  return Boolean(typeof item.id === 'string' && /^[A-Za-z0-9_-]+$/.test(item.id) && typeof item.userId === 'string' && item.userId.length > 0 && typeof item.sourceName === 'string' && typeof item.mimeType === 'string' && typeof item.operation === 'string' && typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt)) && typeof item.text === 'string' && typeof item.result === 'string');
}

export async function persistFileAiArchive(db: PrismaClient, item: PersistableFileAiArchive) {
  const user = await db.user.findUnique({ where: { telegramId: item.userId }, select: { id: true } });
  if (!user) return false;
  await db.fileAiArchive.upsert({
    where: { id: item.id },
    create: { id: item.id, userId: user.id, sourceName: item.sourceName.slice(0, 500), mimeType: item.mimeType.slice(0, 200), operation: item.operation.slice(0, 100), sourceTextGzip: gzipSync(Buffer.from(item.text, 'utf8')), result: item.result, createdAt: new Date(item.createdAt) },
    update: { userId: user.id, sourceName: item.sourceName.slice(0, 500), mimeType: item.mimeType.slice(0, 200), operation: item.operation.slice(0, 100), sourceTextGzip: gzipSync(Buffer.from(item.text, 'utf8')), result: item.result, createdAt: new Date(item.createdAt) },
  });
  return true;
}

async function scanUserDirectory(db: PrismaClient, userDirectory: string) {
  const files = await readdir(userDirectory, { withFileTypes: true });
  let synced = 0;
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(userDirectory, entry.name), 'utf8'));
      if (validItem(parsed) && await persistFileAiArchive(db, parsed)) synced += 1;
    } catch {
      // A file may be mid-write. The next sync will retry it.
    }
  }
  return synced;
}

export async function syncLocalFileAiArchives(db: PrismaClient) {
  if (syncRunning) return 0;
  syncRunning = true;
  try {
    let total = 0;
    let users: Array<{ name: string; isDirectory(): boolean }>;
    try { users = await readdir(ARCHIVE_ROOT, { withFileTypes: true }); } catch { return 0; }
    for (const entry of users) {
      if (!entry.isDirectory()) continue;
      total += await scanUserDirectory(db, join(ARCHIVE_ROOT, entry.name));
    }
    return total;
  } finally {
    syncRunning = false;
  }
}

export function startFileAiArchiveSync(db: PrismaClient) {
  const interval = setInterval(() => { void syncLocalFileAiArchives(db).catch((error) => console.error('File AI archive sync error:', error)); }, 15_000);
  interval.unref?.();
  void syncLocalFileAiArchives(db).catch((error) => console.error('File AI archive initial sync error:', error));
  return interval;
}
