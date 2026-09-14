import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

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
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: baseURL,
    // NextAuth refuses to answer /api/auth/session without a secret. The e2e suite never signs
    // anyone in, so any value will do — it just keeps the endpoint from 500ing under the pages.
    env: {
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'e2e-placeholder-secret',
      NEXTAUTH_URL: baseURL,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
