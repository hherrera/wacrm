import Fastify, { type FastifyServerOptions } from 'fastify';
import type { HealthResponse } from '@conexa/shared';

// Construye la app sin escuchar: server.ts la arranca y los tests la
// ejercitan con app.inject(). Los módulos de dominio se registran aquí.
export function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);

  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'conexa-api',
    version: process.env.npm_package_version ?? '0.1.0',
  }));

  return app;
}
