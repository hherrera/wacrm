import { z } from 'zod';

const Env = z.object({
  // API: Supavisor transaction mode (6543). Worker: session mode (5432), needed for LISTEN/NOTIFY.
  DATABASE_URL: z.string().min(1),
  // The HTTP server needs at least one (see auth.ts): JWKS for asymmetric
  // Supabase signing keys, the secret for legacy HS256 tokens.
  SUPABASE_URL: z.url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  // Comma-separated origins allowed by CORS.
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
});
export type Env = z.infer<typeof Env>;

export const parseEnv = (
  source: Record<string, string | undefined> = process.env
): Env => Env.parse(source);
