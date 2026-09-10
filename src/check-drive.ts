import { getDriveFile, listDriveFiles } from './drive.js';

function fail(message: string): never {
  console.error(`Google Drive connection: FAILED`);
  console.error(message);
  process.exit(1);
}

const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
const serviceAccountJsonBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();

if (!rootFolderId) fail('GOOGLE_DRIVE_ROOT_FOLDER_ID secret is missing.');
if (!serviceAccountJson && !serviceAccountJsonBase64) {
  fail('Google service-account credentials are missing.');
}

try {
  const root = await getDriveFile(rootFolderId);
  if (root.mimeType !== 'application/vnd.google-apps.folder') {
    fail(`The configured GOOGLE_DRIVE_ROOT_FOLDER_ID is not a folder. Name: ${root.name}`);
  }

  const files = await listDriveFiles(rootFolderId);

  console.log('Google Drive connection: OK');
  console.log(`Root folder: ${root.name}`);
  console.log(`Files visible under QMRMed: ${files.length}`);
  console.log('Sample paths:');
  for (const file of files.slice(0, 10)) console.log(`- ${file.path}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
}
