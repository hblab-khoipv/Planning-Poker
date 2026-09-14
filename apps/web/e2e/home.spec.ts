import { expect, test } from '@playwright/test';
import { apiBaseUrl } from './helpers/rooms';

test.describe('home page', () => {
  test('renders the Planning Poker landing content', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Planning Poker');
    await expect(page.getByRole('heading', { level: 1, name: 'Planning Poker' })).toBeVisible();
  });

  test('offers both ways into a room (PRD §9.1)', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('home-create-room-link').click();
    await expect(page).toHaveURL(/\/rooms\/new$/);

    await page.goBack();
    await expect(page.getByTestId('join-by-code-form')).toBeVisible();
  });

  test('refuses a code that cannot be a room code without a round trip', async ({ page }) => {
    let requested = false;
    // Only the API counts: Next.js prefetches its own /rooms/new route payload from this page.
    await page.route(`${apiBaseUrl()}/**`, (route) => {
      requested = true;
      return route.abort();
    });

    await page.goto('/');
    await page.getByTestId('join-code-input').fill('nope');
    await page.getByTestId('join-code-submit').click();

    await expect(page.getByTestId('join-code-error')).toBeVisible();
    await expect(page).toHaveURL('/');
    expect(requested).toBe(false);
  });

  test('sends a well-formed code to the join screen', async ({ page }) => {
    await page.goto('/');
    // Lower case with look-alike characters: the client normalises exactly as the API does.
    await page.getByTestId('join-code-input').fill('ilou2345');
    await page.getByTestId('join-code-submit').click();

    await expect(page).toHaveURL(/\/join\/110V2345$/);
  });
});
