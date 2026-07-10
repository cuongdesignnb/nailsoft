import { z } from 'zod';
export const environmentSchema = z.object({ NODE_ENV: z.enum(['development','test','production']).default('development'), PORT: z.coerce.number().int().positive().default(3001), DATABASE_URL: z.string().url(), REDIS_URL: z.string().url() });
