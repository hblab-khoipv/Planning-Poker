import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

const API_PORT = Number(process.env.E2E_API_PORT ?? 4000);
const apiURL = process.env.NEXT_PUBLIC_API_URL ?? `http://127.0.0.1:${API_PORT}`;

/**
 * Both servers must derive session cookies from the *same* secret: `apps/web` issues NextAuth's
 * encrypted JWT with it and `apps/api` decrypts the very same cookie to recognise a signed-in
 * caller (apps/api/src/http/session.ts). With two different values the API would read every
 * request as a guest, and the history specs — the only ones that sign anybody in — would 401.
 */
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? 'e2e-placeholder-secret';

// Playwright loads this config as CommonJS, so `import.meta.url` is not available here.
const repoRoot = path.resolve(__dirname, '../..');

/**
 * The room flow (task 4) is a browser talking to the real API and the real database, so the e2e
 * run starts both servers. `npm run test:e2e` therefore needs `docker compose up -d` and a built
 * API as well as a built web app — see the README.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start --workspace @planning-poker/api',
      cwd: repoRoot,
      url: `${apiURL}/health`,
      env: {
        PORT: String(API_PORT),
        NEXTAUTH_SECRET,
        // The browser runs on 127.0.0.1, which is a different origin to localhost.
        CORS_ORIGIN: `${baseURL},http://localhost:${PORT}`,
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgresql://planning_poker:planning_poker@localhost:5432/planning_poker',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run start -- --port ${PORT}`,
      url: baseURL,
      // NextAuth refuses to answer /api/auth/session without a secret. Most specs never sign
      // anyone in; the history specs do, and they need this to be the API's secret as well.
      env: {
        NEXTAUTH_SECRET,
        NEXTAUTH_URL: baseURL,
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgresql://planning_poker:planning_poker@localhost:5432/planning_poker',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
