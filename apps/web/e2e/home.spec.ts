import { expect, test } from '@playwright/test';
import { DECKS } from '@planning-poker/shared';

test.describe('home page', () => {
  test('renders the Planning Poker landing content', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Planning Poker');
    await expect(page.getByRole('heading', { level: 1, name: 'Planning Poker' })).toBeVisible();
    await expect(page.getByTestId('scaffold-notice')).toContainText('scaffold');
  });

  test('renders every Fibonacci card from the shared deck definition', async ({ page }) => {
    await page.goto('/');

    const cards = page.getByTestId('fibonacci-deck').locator('span');
    await expect(cards).toHaveCount(DECKS.fibonacci.length);
    await expect(cards).toHaveText([...DECKS.fibonacci]);
  });
});
