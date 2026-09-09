import 'dotenv/config';
import { z } from 'zod';

const env = z.object({
  BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ADMIN_IDS: z.string().default(''),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.6-mini'),
  TRIAL_ENABLED: z.coerce.boolean().default(true),
  TRIAL_DAYS: z.coerce.number().int().positive().default(7),
}).parse(process.env);

export const config = {
  ...env,
  adminIds: new Set(env.ADMIN_IDS.split(',').map((x) => x.trim()).filter(Boolean)),
};
