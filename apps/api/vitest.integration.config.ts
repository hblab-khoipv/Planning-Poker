import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api-integration',
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
