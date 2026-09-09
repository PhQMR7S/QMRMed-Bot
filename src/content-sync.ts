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

function contentKind(path: string): ContentKind {
  const lower = path.toLocaleLowerCase();
  if (lower.includes('ministerial') || lower.includes('وزاري') || lower.includes('وزاريات')) return 'MINISTERIAL';
  if (lower.includes('case') || lower.includes('cases') || lower.includes('كيس')) return 'CASE';
  if (lower.includes('question') || lower.includes('questions') || lower.includes('بنك') || lower.includes('سؤال')) return 'QUESTION';
  if (lower.includes('reference') || lower.includes('references') || lower.includes('مرجع')) return 'REFERENCE';
  return 'SOURCE';
}

function metadataFromPath(path: string) {
  const parts = path.split('/').slice(0, -1).filter(Boolean);
  const department = parts.map((part) => DEPARTMENTS[part.trim().toLocaleLowerCase()] ?? part).find((part) => Object.values(DEPARTMENTS).includes(part)) ?? parts[0];
  const stage = parts.find((part) => /(?:stage|year|مرحلة|سنة)\s*[-_ ]*\d+/i.test(part)) ?? null;
  const subjectName = parts.length ? parts[parts.length - 1] : null;
  return { department: department ?? null, stage, subjectName };
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
    let chunks = 0;

    for (const file of files) {
      const text = await downloadDriveText(file);
      if (!text?.trim()) {
        skipped++;
        await db.contentSource.upsert({
          where: { driveFileId: file.id },
          create: {
            driveFileId: file.id,
            name: file.name,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink,
            modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
            checksum: file.md5Checksum,
            kind: contentKind(file.path),
            ...metadataFromPath(file.path),
            approved: config.DRIVE_AUTO_APPROVE,
            indexed: false,
            lastSyncedAt: new Date(),
          },
          update: {
            name: file.name,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink,
            modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
            checksum: file.md5Checksum,
            kind: contentKind(file.path),
            ...metadataFromPath(file.path),
            approved: config.DRIVE_AUTO_APPROVE,
            indexed: false,
            lastSyncedAt: new Date(),
          },
        });
        continue;
      }

      const meta = metadataFromPath(file.path);
      const source = await db.contentSource.upsert({
        where: { driveFileId: file.id },
        create: {
          driveFileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
          checksum: file.md5Checksum,
          kind: contentKind(file.path),
          ...meta,
          approved: config.DRIVE_AUTO_APPROVE,
          indexed: false,
        },
        update: {
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
          checksum: file.md5Checksum,
          kind: contentKind(file.path),
          ...meta,
          approved: config.DRIVE_AUTO_APPROVE,
          indexed: false,
        },
      });

      const parts = chunkText(text, config.DRIVE_CHUNK_CHARS);
      await db.$transaction(async (tx) => {
        await tx.contentChunk.deleteMany({ where: { sourceId: source.id } });
        for (let i = 0; i < parts.length; i++) {
          const subject = meta.subjectName
            ? await tx.subject.findFirst({ where: { name: { equals: meta.subjectName } }, select: { id: true } })
            : null;
          await tx.contentChunk.create({
            data: {
              sourceId: source.id,
              subjectId: subject?.id,
              kind: contentKind(file.path),
              title: file.name,
              text: parts[i],
              chunkIndex: i,
              driveFileId: file.id,
            },
          });
        }
        await tx.contentSource.update({ where: { id: source.id }, data: { indexed: parts.length > 0, lastSyncedAt: new Date() } });
      });
      indexed++;
      chunks += parts.length;
    }

    await db.driveSyncState.update({
      where: { rootFolderId: root },
      data: { lastSuccessAt: new Date(), lastError: null, filesSeen: files.length, filesIndexed: indexed },
    });
    return { filesSeen: files.length, filesIndexed: indexed, filesSkipped: skipped, chunks } satisfies SyncResult;
  } catch (error) {
    await db.driveSyncState.update({
      where: { rootFolderId: root },
      data: { lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) },
    });
    throw error;
  }
}
