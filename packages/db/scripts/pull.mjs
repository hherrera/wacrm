// Regenerates src/generated/schema.ts + relations.ts from the database (ADR-003).
// Usage: npm run db:pull -w @conexa/db   (DATABASE_URL optional, defaults to local Supabase)
import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';

const dir = new URL('../src/generated/', import.meta.url);
execSync('drizzle-kit pull', { stdio: 'inherit' });

// We never use drizzle-kit migrations: drop its SQL snapshot + meta.
rmSync(new URL('meta', dir), { recursive: true, force: true });
for (const f of readdirSync(dir))
  if (f.endsWith('.sql')) rmSync(new URL(f, dir));

const file = new URL('schema.ts', dir);
const src = readFileSync(file, 'utf8')
  // drizzle-kit can't map tsvector: use our customType.
  .replace(/^\s*\/\/ TODO: failed to parse database type 'tsvector'\n/gm, '')
  .replace(/\bunknown\(/g, 'tsvector(')
  // FKs to auth.users (outside schemaFilter) reference `users`; relations.ts imports `usersInAuth`.
  .replace(
    /^(import .* from "drizzle-orm\/pg-core")\n/m,
    '$1\nimport { tsvector, usersInAuth, usersInAuth as users } from "../types"\nexport { usersInAuth }\n'
  );
if (/\bunknown\(/.test(src))
  throw new Error('unmapped column type left in schema.ts');
writeFileSync(file, src);
