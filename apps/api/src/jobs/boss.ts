import { PgBoss } from 'pg-boss';

// Queue names (catalog: docs/conexa/spec/11-colas-y-trabajos.md §4).
export const QUEUES = {
  maintenanceCleanup: 'maintenance.cleanup',
} as const;

/**
 * pg-boss lives in its own `pgboss` schema, outside the SQL migrations.
 * Only the worker migrates, supervises and runs cron; the API (0.4+) only sends,
 * usually inside a Drizzle transaction via `{ db: fromDrizzle(tx, sql) }`.
 */
export function createBoss(connectionString: string, role: 'api' | 'worker') {
  const worker = role === 'worker';
  return new PgBoss({
    connectionString,
    schema: 'pgboss',
    application_name: `conexa-${role}`,
    max: worker ? 10 : 2,
    migrate: worker,
    supervise: worker,
    schedule: worker,
    useListenNotify: worker,
  });
}
