import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ override: false });

const nonEmptyString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().min(1).optional());

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return value;
}, z.boolean());

const positiveInt = (fallback: number) => z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}, z.number().int().positive());

const boundedInt = (fallback: number, min: number, max: number) => z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}, z.number().int().min(min).max(max));

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try { return new URL(trimmed).toString(); } catch { return undefined; }
}, z.string().url().optional());

const env = z.object({
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ADMIN_IDS: z.string().default(''),

  OMNIROUTE_URL: optionalUrl.default('http://127.0.0.1:20128'),
  OMNIROUTE_API_KEY: nonEmptyString,
  OMNIROUTE_MODEL: z.string().default('auto'),
  OMNIROUTE_TIMEOUT_MS: positiveInt(45_000),
  OMNIROUTE_GROUP_DEFAULT: nonEmptyString,
  OMNIROUTE_GROUP_STUDY: nonEmptyString,
  OMNIROUTE_GROUP_CASES: nonEmptyString,
  OMNIROUTE_GROUP_QUESTIONS: nonEmptyString,
  OMNIROUTE_GROUP_MINISTERIAL: nonEmptyString,
  OMNIROUTE_GROUP_EXAMS: nonEmptyString,
  OMNIROUTE_GROUP_SEARCH: nonEmptyString,
  OMNIROUTE_GROUP_ADMIN: nonEmptyString,

  WEB_SEARCH_PROVIDER: z.preprocess((value) => {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    return normalized === 'firecrawl' || normalized === 'none' ? normalized : undefined;
  }, z.enum(['firecrawl', 'none']).default('firecrawl')),
  FIRECRAWL_API_KEY: nonEmptyString,
  FIRECRAWL_SEARCH_TIMEOUT_MS: positiveInt(12_000),
  FIRECRAWL_SEARCH_LIMIT: boundedInt(5, 1, 10),

  MINI_APP_URL: optionalUrl,
  MINI_APP_BOT_USERNAME: z.string().regex(/^@?[A-Za-z0-9_]{5,32}$/).optional(),
  MINI_APP_HOST: z.string().default('127.0.0.1'),
  MINI_APP_PORT: positiveInt(3000),

  PLUS_MONTH_STARS: positiveInt(250),
  PRO_MONTH_STARS: positiveInt(500),
  PLUS_5MONTH_STARS: positiveInt(500),
  PRO_5MONTH_STARS: positiveInt(1000),
  PLUS_YEAR_STARS: positiveInt(1000),
  PRO_YEAR_STARS: positiveInt(2000),

  PAYMENT_PROVIDER: z.string().default('telegram_stars'),
  SUPPORT_HANDLE: z.string().default(''),
  MASTERCARD_ACCOUNT: z.string().default(''),
  ZAINCASH_NUMBER: z.string().default(''),
  CRYPTO_PAYMENT_NOTE: z.string().default('العملات الرقمية عبر محفظة تيليجرام — قريبًا.'),
  TRIAL_ENABLED: booleanFromEnv.default(true),
  TRIAL_DAYS: positiveInt(7),

  GOOGLE_DRIVE_ROOT_FOLDER_ID: nonEmptyString,
  GOOGLE_SERVICE_ACCOUNT_JSON: nonEmptyString,
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: nonEmptyString,
  DRIVE_AUTO_APPROVE: booleanFromEnv.default(false),
  DRIVE_CHUNK_CHARS: boundedInt(6000, 1000, 20_000),
}).parse(process.env);

export const config = {
  ...env,
  adminIds: new Set(env.ADMIN_IDS.split(',').map((x) => x.trim()).filter(Boolean)),
};
