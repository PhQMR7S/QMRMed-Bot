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

/** Accept either a raw Drive folder ID or a standard Drive folder URL. */
export function normalizeDriveFolderId(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^https?:\/\/drive\.google\.com\/drive\/folders\/([^/?#]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return trimmed;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

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

  const response = await fetch(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Google OAuth ${response.status}: ${raw.slice(0, 500)}`);
  const token = JSON.parse(raw) as TokenResponse;
  cachedToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return token.access_token;
}

async function driveFetch(path: string, init?: RequestInit) {
  const token = await accessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Google Drive ${response.status}: ${raw.slice(0, 500)}`);
  }
  return response;
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

  while (queue.length) {
    const current = queue.shift()!;
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
          queue.push({ id: file.id, path });
        } else {
          result.push({ ...file, path });
        }
      }
      pageToken = data.nextPageToken ?? '';
    } while (pageToken);
  }
  return result;
}
