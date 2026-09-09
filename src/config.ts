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
  TRIAL_ENABLED: booleanFromEnv.default(true),
  TRIAL_DAYS: z.coerce.number().int().positive().default(7),
}).parse(process.env);

export const config = {
  ...env,
  adminIds: new Set(env.ADMIN_IDS.split(',').map((x) => x.trim()).filter(Boolean)),
};
