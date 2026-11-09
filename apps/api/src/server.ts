import { buildApp } from './app';
import { createVerifier } from './auth';
import { createDb } from './db';
import { parseEnv } from './env';

const env = parseEnv();
const db = createDb(env.DATABASE_URL);
const app = await buildApp(
  { db, verifyToken: createVerifier(env), webOrigin: env.WEB_ORIGIN },
  { logger: true }
);
app.addHook('onClose', () => db.$client.end());

await app.listen({ port: env.PORT, host: env.HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
