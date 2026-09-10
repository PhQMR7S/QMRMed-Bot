import type { ContentKind, Plan } from '@prisma/client';
import { db } from './db.js';
import { config } from './config.js';
import { syncGoogleDrive } from './content-sync.js';

export type AdminDashboard = {
  users: number; free: number; plus: number; pro: number;
  subjects: number; topics: number; lessons: number; questions: number;
  ministerialQuestions: number; attempts: number; approvedSources: number;
  indexedSources: number; chunks: number;
};

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const [users, free, plus, pro, subjects, topics, lessons, questions, ministerialQuestions, attempts, approvedSources, indexedSources, chunks] = await Promise.all([
    db.user.count(), db.user.count({ where: { plan: 'FREE' } }), db.user.count({ where: { plan: 'PLUS' } }), db.user.count({ where: { plan: 'PRO' } }),
    db.subject.count(), db.topic.count(), db.lesson.count(), db.question.count({ where: { isMinisterial: false } }), db.question.count({ where: { isMinisterial: true } }), db.attempt.count(),
    db.contentSource.count({ where: { approved: true } }), db.contentSource.count({ where: { indexed: true } }), db.contentChunk.count(),
  ]);
  return { users, free, plus, pro, subjects, topics, lessons, questions, ministerialQuestions, attempts, approvedSources, indexedSources, chunks };
}

export async function getDriveStatus() {
  const root = config.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!root) return { configured: false as const, rootFolderId: null, state: null };
  const state = await db.driveSyncState.findUnique({ where: { rootFolderId: root } });
  return { configured: true as const, rootFolderId: root, state };
}

export async function runAdminDriveSync() { return syncGoogleDrive(); }

export async function getContentBreakdown() {
  const kinds: ContentKind[] = ['SOURCE', 'REFERENCE', 'QUESTION', 'MINISTERIAL', 'CASE'];
  return Promise.all(kinds.map(async kind => ({ kind, count: await db.contentSource.count({ where: { kind } }) })));
}

export type AdminActivationCode = {
  id: number; code: string; plan: Plan; durationDays: number; maxUses: number; usedCount: number;
  active: boolean; expiresAt: Date | null; createdAt: Date; createdByTelegramId: string;
  redemptions: Array<{ user: { telegramId: string; username: string | null }; redeemedAt: Date }>;
};

export async function listActivationCodes(take = 10): Promise<AdminActivationCode[]> {
  return db.activationCode.findMany({
    take: Math.min(Math.max(take, 1), 50), orderBy: { createdAt: 'desc' },
    include: { redemptions: { orderBy: { redeemedAt: 'desc' }, take: 5, include: { user: { select: { telegramId: true, username: true } } } } },
  });
}

export async function getActivationCode(id: number): Promise<AdminActivationCode | null> {
  return db.activationCode.findUnique({
    where: { id },
    include: { redemptions: { orderBy: { redeemedAt: 'desc' }, include: { user: { select: { telegramId: true, username: true } } } } },
  });
}

export async function setActivationCodeActive(id: number, active: boolean) {
  const code = await db.activationCode.findUnique({ where: { id } });
  if (!code) throw new Error('كود الاشتراك غير موجود.');
  if (active && code.expiresAt && code.expiresAt <= new Date()) throw new Error('لا يمكن إعادة تفعيل كود منتهي الصلاحية.');
  if (active && code.usedCount >= code.maxUses) throw new Error('لا يمكن إعادة تفعيل كود مستنفد.');
  return db.activationCode.update({ where: { id }, data: { active } });
}
