import 'dotenv/config';
import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return value;
}, z.boolean());

const env = z.object({
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ADMIN_IDS: z.string().default(''),
  OMNIROUTE_URL: z.string().url().default('http://127.0.0.1:20128'),
  OMNIROUTE_API_KEY: z.string().optional(),
  OMNIROUTE_MODEL: z.string().default('auto'),
  OMNIROUTE_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  OMNIROUTE_GROUP_DEFAULT: z.string().optional(),
  OMNIROUTE_GROUP_STUDY: z.string().optional(),
  OMNIROUTE_GROUP_CASES: z.string().optional(),
  OMNIROUTE_GROUP_QUESTIONS: z.string().optional(),
  OMNIROUTE_GROUP_MINISTERIAL: z.string().optional(),
  OMNIROUTE_GROUP_EXAMS: z.string().optional(),
  OMNIROUTE_GROUP_SEARCH: z.string().optional(),
  OMNIROUTE_GROUP_ADMIN: z.string().optional(),
  PLUS_STARS: z.coerce.number().int().positive().optional(),
  PRO_STARS: z.coerce.number().int().positive().optional(),
  PLUS_DAYS: z.coerce.number().int().positive().default(30),
  PRO_DAYS: z.coerce.number().int().positive().default(30),
  PAYMENT_PROVIDER: z.string().default('telegram_stars'),
  SUPPORT_HANDLE: z.string().default(''),
  MASTERCARD_ACCOUNT: z.string().default('8268627075'),
  ZAINCASH_NUMBER: z.string().default('07829774639'),
  CRYPTO_PAYMENT_NOTE: z.string().default('العملات الرقمية عبر محفظة تيليجرام — التفعيل اليدوي بعد التحقق من الأدمن.'),
  DELIVERY_NOTE: z.string().default('التوصيل والإضافات: قريبًا.'),
  TRIAL_ENABLED: booleanFromEnv.default(true),
  TRIAL_DAYS: z.coerce.number().int().positive().default(7),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),
  DRIVE_AUTO_APPROVE: booleanFromEnv.default(true),
  DRIVE_CHUNK_CHARS: z.coerce.number().int().min(1000).max(20000).default(6000),
}).parse(process.env);

export const config = {
  ...env,
  adminIds: new Set(env.ADMIN_IDS.split(',').map((x) => x.trim()).filter(Boolean)),
};
