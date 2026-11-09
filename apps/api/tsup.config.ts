import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // Workspace packages ship TypeScript source; bundle them into dist.
  noExternal: ['@conexa/shared'],
});
