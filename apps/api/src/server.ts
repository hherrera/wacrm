import { buildApp } from './app';

const app = buildApp({ logger: true });
const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: process.env.HOST ?? '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => process.exit(0)));
}
