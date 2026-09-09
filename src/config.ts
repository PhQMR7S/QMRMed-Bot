import 'dotenv/config';
import { z } from 'zod';

const env = z.object({
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ADMIN_IDS: z.string().default(''),
  OMNIROUTE_URL: z.string().url().default('http://127.0.0.1:20128'),
  OMNIROUTE_API_KEY: z.string().optional(),
  OMNIROUTE_MODEL: z.string().default('auto'),
  OMNIROUTE_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  TRIAL_ENABLED: z.coerce.boolean().default(true),
  TRIAL_DAYS: z.coerce.number().int().positive().default(7),
}).parse(process.env);

export const config = {
  ...env,
  adminIds: new Set(env.ADMIN_IDS.split(',').map((x) => x.trim()).filter(Boolean)),
};
