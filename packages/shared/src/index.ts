// Contratos compartidos entre apps/web y apps/api (zod).
// Cada endpoint nuevo de la API define aquí su request/response.
import { z } from 'zod';

export * from './roles';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Body of every non-2xx response from apps/api. */
export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** GET /v1/me */
export const MeResponse = z.object({
  userId: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  role: z.enum(['owner', 'admin', 'agent', 'viewer']),
});
export type MeResponse = z.infer<typeof MeResponse>;
