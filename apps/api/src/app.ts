import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { HealthResponse, MeResponse } from '@conexa/shared';
import { authenticate, type VerifyToken } from './auth';
import type { Db } from './db';
import { registerErrorHandlers } from './errors';

export type AppDeps = { db: Db; verifyToken: VerifyToken; webOrigin: string };

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);

  await app.register(cors, {
    origin: deps.webOrigin.split(',').map((o) => o.trim()),
  });
  await app.register(swagger, {
    openapi: { info: { title: 'Conexa API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get(
    '/health',
    { schema: { response: { 200: HealthResponse } } },
    async () => ({
      status: 'ok' as const,
      service: 'conexa-api',
      version: process.env.npm_package_version ?? '0.1.0',
    })
  );

  // Everything under /v1 requires a Supabase session.
  await app.register(
    async (v1) => {
      v1.addHook('onRequest', authenticate(deps.db, deps.verifyToken));
      v1.withTypeProvider<ZodTypeProvider>().get(
        '/me',
        { schema: { response: { 200: MeResponse } } },
        async (req) => {
          const { userId, accountId, accountName, role } = req.auth;
          return { userId, accountId, accountName, role };
        }
      );
    },
    { prefix: '/v1' }
  );

  return app;
}
