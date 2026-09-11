import { createSign } from 'node:crypto';
import { config } from './config.js';
import { extractText, getDocumentProxy } from 'unpdf';

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  md5Checksum?: string;
  webViewLink?: string;
  parents?: string[];
};

type TokenResponse = { access_token: string; expires_in: number };

let cachedToken: { value: string; expiresAt: number } | null = null;

function serviceAccount(): ServiceAccount {
  const raw = config.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
    ? Buffer.from(config.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8')
    : config.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Google Drive is not configured: provide GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_SERVICE_ACCOUNT_JSON');
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) throw new Error('missing client_email/private_key');
    return parsed;
  } catch (error) {
    throw new Error(`Invalid Google service-account JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function normalizeDriveFolderId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^https?:\/\/drive\.google\.com\/drive\/folders\/([^/?#]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return trimmed;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.GOOGLE_DRIVE_REQUEST_TIMEOUT_MS ?? 20_000));
const REQUEST_RETRIES = 3;

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key).toString('base64url')}`;

  console.log('  Authenticating Google service account...');
  let response: Response;
  try {
    response = await fetch(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Google OAuth request failed or timed out after ${REQUEST_TIMEOUT_MS}ms: ${error instanceof Error ? error.message : String(error)}`);
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${raw.slice(0, 500)}`);
  const token = JSON.parse(raw) as TokenResponse;
  cachedToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  console.log('  Google authentication successful.');
  return token.access_token;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function driveFetch(path: string, init?: RequestInit) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REQUEST_RETRIES; attempt++) {
    const token = await accessToken();
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return response;
      if (!isRetryableStatus(response.status) || attempt === REQUEST_RETRIES) {
        const raw = await response.text();
        throw new Error(`Google Drive ${response.status}: ${raw.slice(0, 500)}`);
      }
      lastError = new Error(`Google Drive ${response.status}`);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /^Google Drive (401|403|404)/.test(error.message)) throw error;
      if (attempt === REQUEST_RETRIES) break;
    }
    const waitMs = 500 * 2 ** (attempt - 1);
    console.log(`    Drive request retry ${attempt}/${REQUEST_RETRIES - 1} in ${waitMs}ms...`);
    await delay(waitMs);
  }
  throw new Error(`Google Drive request failed after ${REQUEST_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function getDriveFile(fileId: string) {
  const id = normalizeDriveFolderId(fileId);
  const response = await driveFetch(`/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,md5Checksum,webViewLink,parents`);
  return response.json() as Promise<DriveFile>;
}

export async function listDriveFiles(rootFolderId: string) {
  const rootId = normalizeDriveFolderId(rootFolderId);
  if (!rootId) throw new Error('Google Drive root folder is empty');
  const result: Array<DriveFile & { path: string }> = [];
  const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: '' }];
  const queuedFolders = new Set<string>([rootId]);
  const visitedFolders = new Set<string>();
  const seenFiles = new Set<string>();
  let foldersScanned = 0;

  while (queue.length) {
    const current = queue.shift()!;
    if (visitedFolders.has(current.id)) continue;
    visitedFolders.add(current.id);
    foldersScanned++;
    console.log(`  Scanning folder ${foldersScanned} (pending: ${queue.length})...`);
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `'${current.id}' in parents and trashed = false`,
        pageSize: '1000',
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,webViewLink,parents)',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await driveFetch(`/files?${params.toString()}`);
      const data = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
      for (const file of data.files ?? []) {
        const path = current.path ? `${current.path}/${file.name}` : file.name;
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          if (!queuedFolders.has(file.id)) {
            queuedFolders.add(file.id);
            queue.push({ id: file.id, path });
          }
        } else if (!seenFiles.has(file.id)) {
          seenFiles.add(file.id);
          result.push({ ...file, path });
        }
      }
      console.log(`    Found ${data.files?.length ?? 0} entries; unique files: ${result.length}; pending folders: ${queue.length}`);
      pageToken = data.nextPageToken ?? '';
    } while (pageToken);
  }
  return result;
}

async function responseBytes(response: Response) {
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function downloadDriveText(file: DriveFile) {
  const googleDoc = file.mimeType === 'application/vnd.google-apps.document';
  const googleSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
  const googleSlides = file.mimeType === 'application/vnd.google-apps.presentation';

  if (googleDoc) {
    const response = await driveFetch(`/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`);
    return response.text();
  }
  if (googleSheet) {
    const response = await driveFetch(`/files/${encodeURIComponent(file.id)}/export?mimeType=text/csv`);
    return response.text();
  }
  if (googleSlides) {
    const response = await driveFetch(`/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`);
    return response.text();
  }

  if (file.mimeType === 'application/pdf') {
    const response = await driveFetch(`/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`);
    const bytes = await responseBytes(response);
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    return String(result.text);
  }

  const supported = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);
  if (!supported.has(file.mimeType)) return null;
  const response = await driveFetch(`/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`);
  const bytes = await responseBytes(response);
  return new TextDecoder().decode(bytes);
}
