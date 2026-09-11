import 'dotenv/config';
import { db } from '../src/db.js';

const { config } = await import('../src/config.js');
const { listDriveFiles } = await import('../src/drive.js');
const { contentKind, metadataFromPath, shouldIndexPath } = await import('../src/content-sync.js');

const root = config.GOOGLE_DRIVE_ROOT_FOLDER_ID;
if (!root) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID is not configured');

const files = await listDriveFiles(root);
const byKind = new Map<string, number>();
const byDepartment = new Map<string, number>();
const byStage = new Map<string, number>();
const bySubject = new Map<string, number>();
let indexable = 0;
let excluded = 0;
let unsupportedStructure = 0;

for (const file of files) {
  if (!shouldIndexPath(file.path)) {
    excluded++;
    continue;
  }
  const kind = contentKind(file.path);
  if (!kind) {
    unsupportedStructure++;
    continue;
  }
  indexable++;
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  const meta = metadataFromPath(file.path);
  if (meta.department) byDepartment.set(meta.department, (byDepartment.get(meta.department) ?? 0) + 1);
  if (meta.stage) byStage.set(meta.stage, (byStage.get(meta.stage) ?? 0) + 1);
  if (meta.subjectName) bySubject.set(meta.subjectName, (bySubject.get(meta.subjectName) ?? 0) + 1);
}

const [sources, chunks, approved, indexed, syncState] = await Promise.all([
  db.contentSource.count(),
  db.contentChunk.count(),
  db.contentSource.count({ where: { approved: true } }),
  db.contentSource.count({ where: { indexed: true } }),
  db.driveSyncState.findUnique({ where: { rootFolderId: root } }),
]);

function printMap(title: string, values: Map<string, number>) {
  console.log(`\n${title}`);
  if (!values.size) {
    console.log('  —');
    return;
  }
  for (const [key, value] of [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${key}: ${value}`);
  }
}

console.log('=== QMRMed Google Drive Diagnostic ===');
console.log(`Drive files discovered: ${files.length}`);
console.log(`Indexable QMRMed files: ${indexable}`);
console.log(`Excluded files: ${excluded}`);
console.log(`Files with unsupported/unrecognized folder structure: ${unsupportedStructure}`);

printMap('By content kind', byKind);
printMap('By department', byDepartment);
printMap('By stage', byStage);
printMap('By subject', bySubject);

console.log('\n=== Database index ===');
console.log(`ContentSource rows: ${sources}`);
console.log(`ContentChunk rows: ${chunks}`);
console.log(`Approved sources: ${approved}`);
console.log(`Indexed sources: ${indexed}`);

console.log('\n=== Last sync ===');
console.log(`Last run: ${syncState?.lastRunAt?.toISOString() ?? 'never'}`);
console.log(`Last success: ${syncState?.lastSuccessAt?.toISOString() ?? 'never'}`);
console.log(`Last error: ${syncState?.lastError ?? 'none'}`);
console.log(`Files seen at last sync: ${syncState?.filesSeen ?? 0}`);
console.log(`Files indexed at last sync: ${syncState?.filesIndexed ?? 0}`);

if (files.length === 0) process.exitCode = 2;
else if (indexable === 0) process.exitCode = 3;
else if (chunks === 0) process.exitCode = 4;
