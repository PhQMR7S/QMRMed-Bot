import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

try {
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
  if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is missing.');

  const [indexedSources, chunks, approvedSources, state] = await Promise.all([
    db.contentSource.count({ where: { indexed: true } }),
    db.contentChunk.count(),
    db.contentSource.count({ where: { approved: true } }),
    db.driveSyncState.findUnique({ where: { rootFolderId } }),
  ]);

  if (!state?.lastSuccessAt) {
    throw new Error('Drive sync did not record a successful run.');
  }

  console.log(JSON.stringify({
    syncOk: true,
    indexedSources,
    chunks,
    approvedSources,
    lastSuccessAt: state.lastSuccessAt.toISOString(),
  }, null, 2));
} finally {
  await db.$disconnect();
}
