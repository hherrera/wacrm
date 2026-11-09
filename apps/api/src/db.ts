import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@conexa/db';

/** Drizzle client. Connects as the DB owner (bypasses RLS): use `withUser` for anything user-scoped. */
export function createDb(url: string, max = 10) {
  // prepare:false — required by Supavisor transaction mode.
  return drizzle(postgres(url, { prepare: false, max }), { schema });
}
export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Runs `fn` in a transaction as the `authenticated` role with the user's JWT claims,
 * so RLS (`auth.uid()`, `is_account_member()`…) applies exactly as it does for PostgREST.
 */
export function withUser<T>(
  db: Db,
  claims: Record<string, unknown>,
  fn: (tx: Tx) => Promise<T>
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('role', 'authenticated', true)`
    );
    return fn(tx);
  });
}
