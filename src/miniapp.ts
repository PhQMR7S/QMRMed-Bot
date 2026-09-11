import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { db, upsertTelegramUser } from './db.js';

type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string };
type AuthenticatedUser = Awaited<ReturnType<typeof upsertTelegramUser>>;

const MINI_APP_PORT = Number(process.env.MINI_APP_PORT || process.env.PORT || 3000);
const MINI_APP_HOST = process.env.MINI_APP_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const STATIC_ROOT = resolve(process.cwd(), 'miniapp');
const MAX_INIT_AGE_SECONDS = 60 * 60;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MINI_APP_URL = process.env.MINI_APP_URL || process.env.RENDER_EXTERNAL_URL || '';
const MINI_APP_BOT_USERNAME = process.env.MINI_APP_BOT_USERNAME || '';
const stars = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
const operationLabels: Record<string, string> = { explain: 'شرح المحاضرة', summary: 'تلخيص دقيق', qa: 'أسئلة قصيرة', mcq: 'MCQ', true_false: 'صح / خطأ', fill_blank: 'أكمل الفراغ', matching: 'مطابقة', cases: 'حالات سريرية', viva: 'Viva / شفوي', mind_map: 'خريطة ذهنية', flowchart: 'مخطط انسيابي', comparison: 'جدول مقارنة', timeline: 'خط زمني', diagnostic: 'خوارزمية تشخيصية', exam: 'اختبار تجريبي' };

function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
function header(req: IncomingMessage, name: string) { const value = req.headers[name.toLowerCase()]; return Array.isArray(value) ? value[0] : value || ''; }

export function validateInitData(initData: string, nowSeconds = Math.floor(Date.now() / 1000)): TelegramUser {
  if (!initData || !BOT_TOKEN) throw new Error('AUTH_MISSING');
  const params = new URLSearchParams(initData);
  const received = params.get('hash');
  if (!received || !/^[a-f0-9]{64}$/i.test(received)) throw new Error('AUTH_INVALID');
  params.delete('hash');
  const dataCheck = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const expected = createHmac('sha256', secret).update(dataCheck).digest('hex');
  const receivedBytes = Buffer.from(received, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) throw new Error('AUTH_INVALID');
  const authDate = Number(params.get('auth_date') || 0);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > nowSeconds + 60 || nowSeconds - authDate > MAX_INIT_AGE_SECONDS) throw new Error('AUTH_EXPIRED');
  const rawUser = params.get('user');
  if (!rawUser) throw new Error('AUTH_USER_MISSING');
  try {
    const user = JSON.parse(rawUser) as TelegramUser;
    if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error();
    return user;
  } catch { throw new Error('AUTH_USER_MISSING'); }
}

export function miniAppErrorStatus(error: unknown) { return error instanceof Error && error.message.startsWith('AUTH_') ? 401 : 500; }
async function auth(req: IncomingMessage) { return upsertTelegramUser(validateInitData(header(req, 'x-telegram-init-data'))); }

async function telegramProfilePhoto(telegramId: string): Promise<string | null> {
  if (!BOT_TOKEN) return null;
  try {
    const photosResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${encodeURIComponent(telegramId)}&limit=1`);
    if (!photosResponse.ok) return null;
    const photos = await photosResponse.json() as { ok?: boolean; result?: { photos?: Array<Array<{ file_id: string; width: number; height: number }>> } };
    const sizes = photos.result?.photos?.[0];
    if (!photos.ok || !sizes?.length) return null;
    const largest = [...sizes].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    const fileResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(largest.file_id)}`);
    if (!fileResponse.ok) return null;
    const file = await fileResponse.json() as { ok?: boolean; result?: { file_path?: string } };
    if (!file.ok || !file.result?.file_path) return null;
    const imageResponse = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${file.result.file_path}`);
    if (!imageResponse.ok) return null;
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${Buffer.from(await imageResponse.arrayBuffer()).toString('base64')}`;
  } catch { return null; }
}

async function archiveFor(userId: number) {
  const rows = await db.fileAiArchive.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, sourceName: true, mimeType: true, operation: true, createdAt: true, result: true } });
  return rows.map(item => ({ id: item.id, sourceName: item.sourceName, mimeType: item.mimeType, operation: item.operation, operationLabel: operationLabels[item.operation] || item.operation, createdAt: item.createdAt.toISOString(), hasResult: Boolean(item.result) }));
}
async function archiveDetail(userId: number, id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const item = await db.fileAiArchive.findFirst({ where: { id, userId }, select: { id: true, sourceName: true, mimeType: true, operation: true, createdAt: true, result: true } });
  return item ? { ...item, operationLabel: operationLabels[item.operation] || item.operation, createdAt: item.createdAt.toISOString() } : null;
}
function subscriptionState(user: AuthenticatedUser, active: { plan: 'FREE' | 'PLUS' | 'PRO'; startsAt: Date; endsAt: Date } | null, now = new Date()) {
  if (active) return { status: 'ACTIVE', label: 'فعال', plan: active.plan, startsAt: active.startsAt.toISOString(), endsAt: active.endsAt.toISOString(), daysRemaining: Math.max(0, Math.ceil((active.endsAt.getTime() - now.getTime()) / 86400000)) };
  if (user.trialEndsAt && user.trialEndsAt > now) return { status: 'TRIAL', label: 'تجربة مجانية', plan: 'FREE' as const, startsAt: user.trialStartedAt?.toISOString() || null, endsAt: user.trialEndsAt.toISOString(), daysRemaining: Math.max(0, Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / 86400000)) };
  return { status: 'FREE', label: 'مجاني', plan: 'FREE' as const, startsAt: null, endsAt: null, daysRemaining: 0 };
}
function miniAppRouteLink(route: string) { if (!MINI_APP_URL) return null; try { const url = new URL(MINI_APP_URL); url.searchParams.set('route', route); return url.toString(); } catch { return null; } }
function botDeepLink(start: string) { if (!MINI_APP_BOT_USERNAME) return null; return `https://t.me/${MINI_APP_BOT_USERNAME.replace(/^@/, '')}?start=${encodeURIComponent(start)}`; }

export async function handleMiniAppRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url || '/', `http://${header(req, 'host') || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'qmrmed-miniapp', time: new Date().toISOString() });
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/miniapp')) return serveStatic('index.html', res);
    if (req.method === 'GET' && url.pathname.startsWith('/miniapp/')) return serveStatic(url.pathname.slice('/miniapp/'.length), res);
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const user = await auth(req);
    if (url.pathname === '/api/me') {
      const now = new Date();
      const [completed, attempts, correct, archive, active, photoUrl] = await Promise.all([
        db.progress.count({ where: { userId: user.id, completed: true } }),
        db.attempt.count({ where: { userId: user.id } }),
        db.attempt.count({ where: { userId: user.id, correct: true } }),
        archiveFor(user.id),
        db.subscription.findFirst({ where: { userId: user.id, active: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { endsAt: 'desc' }, select: { plan: true, startsAt: true, endsAt: true } }),
        telegramProfilePhoto(user.telegramId),
      ]);
      const subscription = subscriptionState(user, active, now);
      return json(res, 200, { user: { id: user.id, telegramId: user.telegramId, username: user.username, firstName: user.firstName, lastName: user.lastName, displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || null, photoUrl }, department: user.department, stage: user.stage, plan: subscription.plan, accountPlan: user.plan, trial: { available: !user.trialUsed, used: user.trialUsed, endsAt: user.trialEndsAt }, subscription, archiveCount: archive.length, progress: { lessonsCompleted: completed, completed, attempts, correct, accuracy: attempts ? Math.round(correct / attempts * 100) : 0 }, links: { miniapp: { home: miniAppRouteLink('home'), plans: miniAppRouteLink('plans'), subscription: miniAppRouteLink('subscription'), archive: miniAppRouteLink('archive'), account: miniAppRouteLink('account') }, bot: { home: botDeepLink('home'), plans: botDeepLink('plans'), activation: botDeepLink('activation') } } });
    }
    if (url.pathname === '/api/plans') return json(res, 200, [
      { code: 'FREE', name: 'FREE', subtitle: 'البداية الأساسية مع تجربة QMRMed.', current: user.plan === 'FREE' && !user.trialEndsAt, durations: [], features: ['الوصول إلى المحتوى المجاني', 'الحساب والأرشيف الشخصي'] },
      { code: 'PLUS', name: 'PLUS', subtitle: 'حدود وميزات تعليمية موسعة.', current: user.plan === 'PLUS', durations: [{ days: 30, label: 'شهر واحد', stars: stars('PLUS_MONTH_STARS', 250) }, { days: 150, label: '5 أشهر', stars: stars('PLUS_5MONTH_STARS', 500) }, { days: 365, label: 'سنة واحدة', stars: stars('PLUS_YEAR_STARS', 1000) }], features: ['حدود AI أعلى', 'ميزات تعليمية موسعة', 'أرشيف موسع'] },
      { code: 'PRO', name: 'PRO', subtitle: 'أعلى مستوى من المنصة التعليمية.', current: user.plan === 'PRO', durations: [{ days: 30, label: 'شهر واحد', stars: stars('PRO_MONTH_STARS', 500) }, { days: 150, label: '5 أشهر', stars: stars('PRO_5MONTH_STARS', 1000) }, { days: 365, label: 'سنة واحدة', stars: stars('PRO_YEAR_STARS', 2000) }], features: ['أولوية أعلى للذكاء الاصطناعي', 'ميزات متقدمة', 'أعلى حدود للاستخدام والأرشيف'] },
    ]);
    if (url.pathname === '/api/archive') return json(res, 200, await archiveFor(user.id));
    if (url.pathname.startsWith('/api/archive/')) { const item = await archiveDetail(user.id, decodeURIComponent(url.pathname.slice('/api/archive/'.length))); return item ? json(res, 200, item) : json(res, 404, { error: 'النتيجة غير موجودة' }); }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Mini App error:', error);
    const status = miniAppErrorStatus(error);
    return json(res, status, { error: status === 401 ? 'جلسة Telegram غير صالحة أو منتهية. افتح Mini App من داخل Telegram مجددًا.' : 'تعذر تحميل بيانات Mini App حاليًا.' });
  }
}
async function serveStatic(relative: string, res: ServerResponse) {
  const safe = resolve(STATIC_ROOT, relative);
  if (!safe.startsWith(`${STATIC_ROOT}/`) && safe !== STATIC_ROOT) return json(res, 404, { error: 'Not found' });
  const ext = extname(safe);
  const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
  try { res.writeHead(200, { 'content-type': type, 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org" }); createReadStream(safe).pipe(res).on('error', () => res.end()); } catch { json(res, 404, { error: 'Not found' }); }
}
export function startMiniApp() { const server = createServer(handleMiniAppRequest); server.listen(MINI_APP_PORT, MINI_APP_HOST, () => console.log(`QMRMed Mini App listening on http://${MINI_APP_HOST}:${MINI_APP_PORT}`)); return server; }
