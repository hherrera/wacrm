import { customType, pgSchema, text, uuid } from 'drizzle-orm/pg-core';

/** Postgres tsvector (read as text; normally a generated column). */
export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

/** Minimal stub of Supabase's auth.users (not introspected: owned by Supabase). Only what FKs need. */
export const usersInAuth = pgSchema('auth').table('users', {
  id: uuid().primaryKey().notNull(),
  email: text(),
});
