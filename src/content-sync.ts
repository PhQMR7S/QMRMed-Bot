import { db } from './db.js';
import { config } from './config.js';
import { downloadDriveText, listDriveFiles } from './drive.js';
import type { ContentKind } from '@prisma/client';

const DEPARTMENTS: Record<string, string> = {
  medicine: 'Medicine',
  'طب عام': 'Medicine',
  pharmacy: 'Pharmacy',
  'صيدلة': 'Pharmacy',
  dentistry: 'Dentistry',
  'طب أسنان': 'Dentistry',
};

const KIND_FOLDER_NAMES = new Set([
  'sources', 'source', 'ministerial', 'ministerials', 'question bank', 'questions',
  'references', 'reference', 'مصادر', 'المصادر', 'وزاريات', 'وزاري', 'بنك الأسئلة', 'الأسئلة', 'مراجع', 'مرجع',
]);

const EXCLUDED_PATH_SEGMENTS = new Set([
  '99 - system',
  '99 - other',
  '01 - import',
  '02 - review',
  '03 - archive',
  '04 - rejected',
  '05 - temporary',
  '05 - duplicates',
  '04 - processed',
  '03 - needs review',
]);

function normalizedSegments(path: string) {
  return path.split('/').filter(Boolean).map((part) => part.trim());
}

function shouldIndexPath(path: string) {
  const segments = normalizedSegments(path).slice(0, -1);
  return !segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment.toLocaleLowerCase()));
}

function contentKind(path: string): ContentKind | null {
  const segments = normalizedSegments(path).slice(0, -1).map((part) => part.toLocaleLowerCase());
  if (segments.some((part) => part.includes('ministerial') || part.includes('وزاري') || part.includes('وزاريات'))) return 'MINISTERIAL';
  if (segments.some((part) => part.includes('question bank') || part === 'questions' || part.includes('بنك الأسئلة') || part === 'الأسئلة')) return 'QUESTION';
  if (segments.some((part) => part === 'references' || part === 'reference' || part.includes('مرجع') || part.includes('medical references') || part.includes('shared references'))) return 'REFERENCE';
  if (segments.some((part) => part === 'sources' || part === 'source' || part.includes('مصادر') || part === 'المصادر')) return 'SOURCE';
  return null;
}

function metadataFromPath(path: string) {
  const parts = normalizedSegments(path).slice(0, -1);
  const normalized = parts.map((part) => DEPARTMENTS[part.toLocaleLowerCase()] ?? part);
  const departmentIndex = normalized.findIndex((part) => Object.values(DEPARTMENTS).includes(part));
  const department = departmentIndex >= 0 ? normalized[departmentIndex] : null;
  const stage = normalized.find((part) => /(?:stage|year|مرحلة|سنة)\s*[-_ ]*\d+/i.test(part)) ?? null;
  const kindIndex = normalized.findIndex((part) => KIND_FOLDER_NAMES.has(part.toLocaleLowerCase()));
  const subjectName = kindIndex > 0 ? normalized[kindIndex - 1] : null;
  return { department, stage, subjectName };
}

function chunkText(text: string, size: number) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf('\n', end), normalized.lastIndexOf(' ', end));
      if (boundary > start + size * 0.6) end = boundary;
    }
    chunks.push(normalized.slice(start, end).trim());
    start = end;
    while (start < normalized.length && /\s/.test(normalized[start])) start++;
  }
  return chunks;
}

export type SyncResult = {
  filesSeen: number;
  filesIndexed: number;
  filesSkipped: number;
  filesRemoved: number;
  chunks: number;
};

export async function syncGoogleDrive() {
  const root = config.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!root) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured');

  const started = new Date();
  await db.driveSyncState.upsert({
    where: { rootFolderId: root },
    create: { rootFolderId: root, lastRunAt: started, lastError: null },
    update: { lastRunAt: started, lastError: null },
  });

  try {
    const files = await listDriveFiles(root);
    let indexed = 0;
    let skipped = 0;
    let removed = 0;
    let chunks = 0;
    const currentIds = new Set<string>();

    for (const file of files) {
      if (!shouldIndexPath(file.path)) {
        skipped++;
        continue;
      }
      const kind = contentKind(file.path);
      if (!kind) {
        skipped++;
        continue;
      }
      currentIds.add(file.id);

      const existing = await db.contentSource.findUnique({ where: { driveFileId: file.id }, select: { id: true, checksum: true, modifiedTime: true, indexed: true } });
      const modified = file.modifiedTime ? new Date(file.modifiedTime) : null;
      const unchanged = existing && existing.indexed && existing.checksum === file.md5Checksum && existing.modifiedTime?.getTime() === modified?.getTime();
      if (unchanged) {
        skipped++;
        continue;
      }

      const text = await downloadDriveText(file);
      const meta = metadataFromPath(file.path);
      const source = await db.contentSource.upsert({
        where: { driveFileId: file.id },
        create: {
          driveFileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          modifiedTime: modified,
          checksum: file.md5Checksum,
          kind,
          ...meta,
          approved: config.DRIVE_AUTO_APPROVE,
          indexed: false,
        },
        update: {
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          modifiedTime: modified,
          checksum: file.md5Checksum,
          kind,
          ...meta,
          indexed: false,
          lastSyncedAt: new Date(),
        },
      });

      if (!text?.trim()) {
        skipped++;
        await db.contentChunk.deleteMany({ where: { sourceId: source.id } });
        await db.contentSource.update({ where: { id: source.id }, data: { indexed: false } });
        continue;
      }

      const parts = chunkText(text, config.DRIVE_CHUNK_CHARS);
      const subject = meta.subjectName
        ? await db.subject.findFirst({ where: { name: meta.subjectName }, select: { id: true } })
        : null;
      await db.$transaction(async (tx) => {
        await tx.contentChunk.deleteMany({ where: { sourceId: source.id } });
        if (parts.length) {
          await tx.contentChunk.createMany({
            data: parts.map((part, i) => ({
              sourceId: source.id,
              subjectId: subject?.id,
              kind,
              title: file.name,
              text: part,
              chunkIndex: i,
              driveFileId: file.id,
            })),
          });
        }
        await tx.contentSource.update({ where: { id: source.id }, data: { indexed: parts.length > 0, lastSyncedAt: new Date() } });
      });
      indexed++;
      chunks += parts.length;
    }

    const stale = await db.contentSource.findMany({ where: { driveFileId: { notIn: [...currentIds] }, indexed: true }, select: { id: true } });
    for (const source of stale) {
      await db.$transaction([
        db.contentChunk.deleteMany({ where: { sourceId: source.id } }),
        db.contentSource.update({ where: { id: source.id }, data: { indexed: false, approved: false } }),
      ]);
      removed++;
    }

    await db.driveSyncState.update({
      where: { rootFolderId: root },
      data: { lastSuccessAt: new Date(), lastError: null, filesSeen: files.length, filesIndexed: indexed },
    });
    return { filesSeen: files.length, filesIndexed: indexed, filesSkipped: skipped, filesRemoved: removed, chunks } satisfies SyncResult;
  } catch (error) {
    await db.driveSyncState.update({
      where: { rootFolderId: root },
      data: { lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) },
    });
    throw error;
  }
}
