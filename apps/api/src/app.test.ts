import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorResponse, HealthResponse } from '@conexa/shared';
import { buildApp } from './app';
import { createVerifier } from './auth';
import { createDb } from './db';
import { TEST_JWT_SECRET as SECRET, signToken } from './test-utils';

// postgres-js connects lazily: these tests never reach the DB.
const db = createDb('postgres://unused@127.0.0.1:1/none');
const verifyToken = createVerifier({ SUPABASE_JWT_SECRET: SECRET });
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ db, verifyToken, webOrigin: 'http://localhost:3000' });
});
afterAll(() => app.close());

describe('api', () => {
  it('GET /health cumple HealthResponse', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json()).service).toBe('conexa-api');
  });

  it('404 con el formato ErrorResponse', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(ErrorResponse.parse(res.json()).error.code).toBe('not_found');
  });

  it('/v1 sin token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(ErrorResponse.parse(res.json()).error.code).toBe('unauthorized');
  });

  it('/v1 con token de otra clave o audiencia → 401', async () => {
    const sub = crypto.randomUUID();
    for (const token of [
      await signToken(sub, {
        secret: 'another-secret-with-at-least-32-chars!!',
      }),
      await signToken(sub, { aud: 'anon' }),
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('expone OpenAPI en /docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toContain('/v1/me');
  });
});
