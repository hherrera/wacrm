// Contratos compartidos entre apps/web y apps/api (zod).
// Cada endpoint nuevo de la API define aquí su request/response.
import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
