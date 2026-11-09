import type { PgBoss } from 'pg-boss';
import { QUEUES } from './boss';

/** Creates queues, schedules and handlers. Idempotent: runs on every worker start. */
export async function registerJobs(boss: PgBoss, log: (msg: string) => void) {
  await boss.createQueue(QUEUES.maintenanceCleanup, { policy: 'exclusive' });
  await boss.schedule(QUEUES.maintenanceCleanup, '0 3 * * *', null, {
    tz: 'America/Bogota',
  });
  await boss.work(QUEUES.maintenanceCleanup, async ([job]) => {
    // ponytail: no-op until inbound_events lands (0.3); then purge > 30 days except email .eml (ADR-006).
    log(`maintenance.cleanup ran (job ${job?.id})`);
  });
}
