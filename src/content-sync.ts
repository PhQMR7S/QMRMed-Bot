import { db } from './db.js';
import { config } from './config.js';
import { downloadDriveText, listDriveFiles, normalizeDriveFolderId } from './drive.js';
import type { ContentKind } from '@prisma/client';

const DEPARTMENTS: Record<string, string> = {
  medicine: 'Medicine', medical: 'Medicine', 'طب': 'Medicine', 'طب عام': 'Medicine', 'طب بشري': 'Medicine',
  pharmacy: 'Pharmacy', 'صيدلة': 'Pharmacy', 'الصيدلة': 'Pharmacy',
  dentistry: 'Dentistry', 'طب أسنان': 'Dentistry', 'طب الأسنان': 'Dentistry', 'اسنان': 'Dentistry', 'أسنان': 'Dentistry',
  nursing: 'Nursing', 'تمريض': 'Nursing', 'التمريض': 'Nursing',
  anesthesia: 'Anesthesia', 'تخدير': 'Anesthesia', 'التخدير': 'Anesthesia', 'تقنيات التخدير': 'Anesthesia',
  radiology: 'Radiology', 'اشعة': 'Radiology', 'أشعة': 'Radiology', 'الاشعة': 'Radiology', 'الأشعة': 'Radiology',
  'تقنيات الأشعة والسونار': 'Radiology', 'تقنيات الاشعة والسونار': 'Radiology',
  laboratory: 'Medical Laboratory Techniques', 'مختبرات': 'Medical Laboratory Techniques', 'المختبرات': 'Medical Laboratory Techniques', 'تقنيات المختبرات الطبية': 'Medical Laboratory Techniques',
  dental: 'Dental Technology', 'صناعة الأسنان': 'Dental Technology', 'تقنيات صناعة الأسنان': 'Dental Technology',
  physiotherapy: 'Physiotherapy', 'علاج طبيعي': 'Physiotherapy', 'العلاج الطبيعي': 'Physiotherapy', 'تقنيات العلاج الطبيعي': 'Physiotherapy',
  optics: 'Optics', 'بصريات': 'Optics', 'البصريات': 'Optics', 'تقنيات البصريات': 'Optics',
  emergency: 'Emergency Medical Techniques', 'طوارئ': 'Emergency Medical Techniques', 'الطوارئ': 'Emergency Medical Techniques', 'طب الطوارئ': 'Emergency Medical Techniques', 'تقنيات طب الطوارئ': 'Emergency Medical Techniques',
  cardiac: 'Cardiac Care Techniques', 'عناية القلب': 'Cardiac Care Techniques', 'عناية قلب': 'Cardiac Care Techniques', 'تقنيات عناية القلب': 'Cardiac Care Techniques',
};

const KIND_FOLDER_NAMES = new Set([
  'sources', 'source', 'المصادر', 'مصادر', 'references', 'reference', 'shared references', 'مراجع', 'مرجع', 'المراجع',
  'ministerial', 'ministerials', 'وزاريات', 'وزاري', 'الوزاريات', 'الأسئلة الوزارية', 'أسئلة وزارية',
  'question bank', 'questions', 'بنك الأسئلة', 'الأسئلة', 'الاسئلة', 'أسئلة', 'اسئلة',
  'cases', 'case', 'حالات', 'الحالات', 'حالات سريرية', 'الحالات السريرية',
]);

const EXCLUDED_PATH_SEGMENTS = new Set([
  '99 - system', '99 - other', '01 - import', '02 - review', '03 - archive', '04 - rejected', '05 - temporary',
  '05 - duplicates', '04 - processed', '03 - needs review',
]);

const ARABIC_STAGES: Record<string, string> = {
  'الأولى': '1', 'الاولى': '1', 'الثانية': '2', 'الثانيه': '2', 'الثالثة': '3', 'الثالثه': '3',
  'الرابعة': '4', 'الرابعه': '4', 'الخامسة': '5', 'الخامسه': '5', 'السادسة': '6', 'السادسه': '6',
};

const MATERIALS_FOLDER_NAMES = new Set(['materials', 'material', 'المواد', 'مادة', 'مواد']);

export function normalizeFolderName(part: string) { return part.trim().replace(/^\d+\s*-\s*/, '').trim(); }
export function normalizedSegments(path: string) { return path.split('/').filter(Boolean).map(normalizeFolderName); }
export function shouldIndexPath(path: string) {
  const segments = path.split('/').filter(Boolean).slice(0, -1).map((part) => part.trim().toLocaleLowerCase());
  return !segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment));
}
export function isKindFolder(part: string) {
  const normalized = normalizeFolderName(part).toLocaleLowerCase();
  return KIND_FOLDER_NAMES.has(normalized)
    || normalized.includes('ministerial') || normalized.includes('وزاري') || normalized.includes('وزاريات')
    || normalized.includes('question bank') || normalized.includes('بنك الأسئلة') || normalized.includes('shared references')
    || normalized.includes('مرجع') || normalized.includes('مصادر') || normalized.includes('حالات سريرية') || normalized.includes('الحالات السريرية');
}
function isMaterialsFolder(part: string) { return MATERIALS_FOLDER_NAMES.has(normalizeFolderName(part).toLocaleLowerCase()); }

export function contentKind(path: string): ContentKind | null {
  const segments = normalizedSegments(path).slice(0, -1).map((part) => part.toLocaleLowerCase());
  if (segments.some((part) => part.includes('ministerial') || part.includes('وزاري') || part.includes('وزاريات'))) return 'MINISTERIAL';
  if (segments.some((part) => part === 'question bank' || part === 'questions' || part.includes('بنك الأسئلة') || part === 'الأسئلة' || part === 'الاسئلة' || part === 'أسئلة' || part === 'اسئلة')) return 'QUESTION';
  if (segments.some((part) => part === 'cases' || part === 'case' || part.includes('حالات سريرية') || part.includes('الحالات السريرية'))) return 'CASE';
  if (segments.some((part) => part === 'references' || part === 'reference' || part.includes('مرجع') || part.includes('مراجع') || part.includes('shared references'))) return 'REFERENCE';
  if (segments.some((part) => part === 'sources' || part === 'source' || part.includes('مصادر') || part === 'المصادر')) return 'SOURCE';
  if (segments.some(isMaterialsFolder)) return 'SOURCE';
  return null;
}

export function normalizeStage(part: string) {
  const normalized = normalizeFolderName(part).toLocaleLowerCase();
  const match = normalized.match(/(?:stage|year|مرحلة|سنة)\s*[-_ ]*(\d+)/i);
  if (match?.[1]) return match[1];
  const arabicMatch = normalized.match(/(?:ال)?(?:مرحلة|سنة)\s*[-_ ]*(الأولى|الاولى|الثانية|الثانيه|الثالثة|الثالثه|الرابعة|الرابعه|الخامسة|الخامسه|السادسة|السادسه)/);
  if (arabicMatch?.[1]) return ARABIC_STAGES[arabicMatch[1]] ?? null;
  return ARABIC_STAGES[normalized] ?? null;
}

function canonicalDepartment(part: string) { return DEPARTMENTS[normalizeFolderName(part).toLocaleLowerCase()] ?? null; }

export function metadataFromPath(path: string) {
  const parts = normalizedSegments(path).slice(0, -1);
  const departmentIndex = parts.findIndex((part) => canonicalDepartment(part) !== null);
  const department = departmentIndex >= 0 ? canonicalDepartment(parts[departmentIndex]) : null;
  const stageIndex = parts.findIndex((part, index) => index > departmentIndex && normalizeStage(part) !== null);
  const stage = stageIndex >= 0 ? normalizeStage(parts[stageIndex]) : null;
  let subjectName: string | null = null;

  if (stageIndex >= 0) {
    const afterStage = parts.slice(stageIndex + 1);
    const kindIndex = afterStage.findIndex((part) => isKindFolder(part) || isMaterialsFolder(part));
    if (kindIndex >= 0) {
      const kindPart = afterStage[kindIndex];
      const beforeKind = afterStage.slice(0, kindIndex);
      const afterKind = afterStage.slice(kindIndex + 1);
      subjectName = isMaterialsFolder(kindPart) ? (afterKind[0] ?? null) : (beforeKind[beforeKind.length - 1] ?? null);
    }
  }

  return { department, stage, subjectName };
}

export function chunkText(text: string, size: number) {
  if (!Number.isFinite(size) || size <= 0) throw new Error('Chunk size must be greater than zero');
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

export type SyncResult = { filesSeen: number; filesIndexed: number; filesSkipped: number; filesRemoved: number; chunks: number };

export async function syncGoogleDrive() {
  const configuredRoot = config.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!configuredRoot) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured');
  const root = normalizeDriveFolderId(configuredRoot);
  if (!root) throw new Error('Google Drive root folder is empty');

  const started = new Date();
  await db.driveSyncState.upsert({ where: { rootFolderId: root }, create: { rootFolderId: root, lastRunAt: started, lastError: null }, update: { lastRunAt: started, lastError: null } });

  try {
    const files = await listDriveFiles(root);
    if (!files.length) throw new Error('Google Drive scan returned zero files; stale-content cleanup was intentionally skipped. Verify root folder and credentials before retrying.');

    let indexed = 0, skipped = 0, removed = 0, chunks = 0;
    const currentIds = new Set<string>();

    for (const file of files) {
      if (!shouldIndexPath(file.path)) { skipped++; continue; }
      const kind = contentKind(file.path);
      if (!kind) { skipped++; continue; }
      currentIds.add(file.id);

      const existing = await db.contentSource.findUnique({ where: { driveFileId: file.id }, select: { id: true, checksum: true, modifiedTime: true, indexed: true } });
      const modified = file.modifiedTime ? new Date(file.modifiedTime) : null;
      const unchanged = Boolean(existing?.indexed && existing.checksum === file.md5Checksum && existing.modifiedTime?.getTime() === modified?.getTime());
      if (unchanged) { skipped++; continue; }

      const text = await downloadDriveText(file);
      const meta = metadataFromPath(file.path);
      const source = await db.contentSource.upsert({
        where: { driveFileId: file.id },
        create: { driveFileId: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink, modifiedTime: modified, checksum: file.md5Checksum, kind, ...meta, approved: config.DRIVE_AUTO_APPROVE, indexed: false },
        update: { name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink, modifiedTime: modified, checksum: file.md5Checksum, kind, ...meta, indexed: false, lastSyncedAt: new Date() },
      });

      if (!text?.trim()) {
        skipped++;
        await db.$transaction([db.contentChunk.deleteMany({ where: { sourceId: source.id } }), db.contentSource.update({ where: { id: source.id }, data: { indexed: false } })]);
        continue;
      }

      const parts = chunkText(text, config.DRIVE_CHUNK_CHARS);
      const subject = meta.subjectName ? await db.subject.findFirst({ where: { name: meta.subjectName }, select: { id: true } }) : null;

      await db.$transaction(async (tx) => {
        await tx.contentChunk.deleteMany({ where: { sourceId: source.id } });
        if (parts.length) await tx.contentChunk.createMany({ data: parts.map((part, i) => ({ sourceId: source.id, subjectId: subject?.id, kind, title: file.name, text: part, chunkIndex: i, driveFileId: file.id })) });
        await tx.contentSource.update({ where: { id: source.id }, data: { indexed: parts.length > 0, lastSyncedAt: new Date() } });
      });

      indexed++;
      chunks += parts.length;
    }

    if (currentIds.size === 0) throw new Error('Google Drive scan found no indexable QMRMed files; stale-content cleanup was intentionally skipped. Verify the folder structure before retrying.');

    const stale = await db.contentSource.findMany({ where: { driveFileId: { notIn: [...currentIds] }, indexed: true }, select: { id: true } });
    for (const source of stale) {
      await db.$transaction([db.contentChunk.deleteMany({ where: { sourceId: source.id } }), db.contentSource.update({ where: { id: source.id }, data: { indexed: false, approved: false } })]);
      removed++;
    }

    await db.driveSyncState.update({ where: { rootFolderId: root }, data: { lastSuccessAt: new Date(), lastError: null, filesSeen: files.length, filesIndexed: indexed } });
    return { filesSeen: files.length, filesIndexed: indexed, filesSkipped: skipped, filesRemoved: removed, chunks } satisfies SyncResult;
  } catch (error) {
    await db.driveSyncState.update({ where: { rootFolderId: root }, data: { lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) } });
    throw error;
  }
}
