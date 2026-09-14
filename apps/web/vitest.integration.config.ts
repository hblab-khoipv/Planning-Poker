import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web-integration',
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    // Shares one Postgres database with the API's integration suite, so no parallel files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
