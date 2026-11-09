import { defineConfig } from 'drizzle-kit';

// The SQL migrations in supabase/migrations are the source of truth
// (ADR-003). This config is only used to INTROSPECT the database into
// src/generated after a migration lands:  npm run db:pull -w @conexa/db
// Never use drizzle-kit generate/migrate/push here.
export default defineConfig({
  dialect: 'postgresql',
  out: './src/generated',
  schemaFilter: ['public'],
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  },
  introspect: { casing: 'camel' },
});
