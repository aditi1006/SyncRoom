import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package so `dist` is self-contained apart from npm deps.
  noExternal: ['@syncroom/shared'],
});
