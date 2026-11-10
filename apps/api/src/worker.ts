import { parseEnv } from './env';
import { createBoss } from './jobs/boss';
import { registerJobs } from './jobs/register';

const env = parseEnv();
const boss = createBoss(env.WORKER_DATABASE_URL ?? env.DATABASE_URL, 'worker');
boss.on('error', (err) => console.error('[pg-boss]', err));

await boss.start();
await registerJobs(boss, (msg) => console.log(`[worker] ${msg}`));
console.log('[worker] started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(
    signal,
    () => void boss.stop({ graceful: true }).then(() => process.exit(0))
  );
}
