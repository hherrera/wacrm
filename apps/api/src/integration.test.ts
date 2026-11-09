// Runs against a real Postgres with the Supabase migrations applied (local: `npm run db:start -w @conexa/db`).
// Skipped unless DATABASE_URL is set, e.g. DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { MeResponse } from '@conexa/shared';
import { accounts, profiles, usersInAuth } from '@conexa/db';
import { buildApp } from './app';
import { TEST_JWT_SECRET as SECRET, signToken } from './test-utils';
import { createVerifier } from './auth';
import { createDb, withUser } from './db';
import { createBoss } from './jobs/boss';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('integración (Postgres)', () => {
  const db = createDb(url!);
  const boss = createBoss(url!, 'worker');
  const users = [crypto.randomUUID(), crypto.randomUUID()];
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    // handle_new_user creates an account + owner profile for each.
    for (const id of users) {
      await db.execute(
        sql`insert into auth.users (id, email, raw_user_meta_data) values (${id}, ${`${id}@test.local`}, '{"full_name":"Test"}')`
      );
    }
    app = await buildApp({
      db,
      verifyToken: createVerifier({ SUPABASE_JWT_SECRET: SECRET }),
      webOrigin: '*',
    });
    await boss.start();
  });

  afterAll(async () => {
    await app?.close();
    await boss.stop({ graceful: false });
    const owned = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.ownerUserId, users));
    await db.delete(profiles).where(inArray(profiles.userId, users));
    if (owned.length)
      await db.delete(accounts).where(
        inArray(
          accounts.id,
          owned.map((a) => a.id)
        )
      );
    await db.delete(usersInAuth).where(inArray(usersInAuth.id, users));
    await db.$client.end();
  });

  it('request autenticado → 200 con la cuenta del usuario', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${await signToken(users[0]!)}` },
    });
    expect(res.statusCode).toBe(200);
    const me = MeResponse.parse(res.json());
    expect(me).toMatchObject({
      userId: users[0],
      role: 'owner',
      accountName: 'Test',
    });
  });

  it('token válido de un usuario sin cuenta → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: {
        authorization: `Bearer ${await signToken(crypto.randomUUID())}`,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('withUser aplica RLS: sólo ve perfiles de su cuenta', async () => {
    const visible = await withUser(
      db,
      { sub: users[0], role: 'authenticated' },
      (tx) =>
        tx
          .select({ userId: profiles.userId })
          .from(profiles)
          .where(inArray(profiles.userId, users))
    );
    expect(visible.map((p) => p.userId)).toEqual([users[0]]);
  });

  it('pg-boss: encolar dentro de la transacción de Drizzle (commit sí, rollback no)', async () => {
    const queue = `test.tx.${Date.now()}`;
    await boss.createQueue(queue);

    await db.transaction(async (tx) => {
      await boss.send(queue, { n: 1 }, { db: fromDrizzle(tx, sql) });
    });
    await db
      .transaction(async (tx) => {
        await boss.send(queue, { n: 2 }, { db: fromDrizzle(tx, sql) });
        throw new Error('rollback');
      })
      .catch(() => {});

    const jobs = await boss.fetch<{ n: number }>(queue, { batchSize: 10 });
    expect(jobs.map((j) => j.data.n)).toEqual([1]);
    await boss.deleteQueue(queue);
  });
});
