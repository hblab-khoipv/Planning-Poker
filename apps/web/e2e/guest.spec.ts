import { PARTICIPANT_ID_STORAGE_KEY } from '@planning-poker/shared';
import { expect, test } from '@playwright/test';

/**
 * Guest identity end to end (PRD §3.1.2, FR-2): a name and a browser-stored participant id,
 * with no account and no call to NextAuth.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('guest identity', () => {
  test('turns a typed name into a persistent participant id', async ({ page }) => {
    await page.goto('/join');

    await page.getByLabel('Tên hiển thị').fill('Khôi');
    await page.getByRole('button', { name: 'Lưu tên và tiếp tục' }).click();

    await expect(page.getByTestId('guest-display-name')).toHaveText('Khôi');
    const participantId = await page.getByTestId('guest-participant-id').innerText();
    expect(participantId).toMatch(UUID);

    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      PARTICIPANT_ID_STORAGE_KEY,
    );
    expect(stored).toBe(participantId);

    // Same browser, same person: reloading must not mint a second identity.
    await page.reload();
    await expect(page.getByTestId('guest-participant-id')).toHaveText(participantId);
    await expect(page.getByLabel('Tên hiển thị')).toHaveValue('Khôi');
  });

  test('keeps the id when the guest renames themselves', async ({ page }) => {
    await page.goto('/join');
    await page.getByLabel('Tên hiển thị').fill('Tên cũ');
    await page.getByRole('button', { name: 'Lưu tên và tiếp tục' }).click();
    const first = await page.getByTestId('guest-participant-id').innerText();

    await page.getByLabel('Tên hiển thị').fill('Tên mới');
    await page.getByRole('button', { name: 'Lưu tên và tiếp tục' }).click();

    await expect(page.getByTestId('guest-display-name')).toHaveText('Tên mới');
    await expect(page.getByTestId('guest-participant-id')).toHaveText(first);
  });

  test('never signs the guest in', async ({ page }) => {
    await page.goto('/join');
    await page.getByLabel('Tên hiển thị').fill('Khôi');
    await page.getByRole('button', { name: 'Lưu tên và tiếp tục' }).click();
    await expect(page.getByTestId('guest-identity')).toBeVisible();

    await page.goto('/');
    await expect(page.getByTestId('auth-status')).toContainText('Chưa đăng nhập');

    const cookies = await page.context().cookies();
    expect(
      cookies.find((cookie) => cookie.name.includes('next-auth.session-token')),
    ).toBeUndefined();
  });
});
