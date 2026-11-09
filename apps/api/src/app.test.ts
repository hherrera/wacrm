import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@conexa/shared';
import { buildApp } from './app';

describe('GET /health', () => {
  it('responde con el contrato HealthResponse', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json()).service).toBe('conexa-api');
    await app.close();
  });

  it('devuelve 404 en rutas desconocidas', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
