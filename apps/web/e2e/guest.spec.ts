import { PARTICIPANT_ID_STORAGE_KEY } from '@planning-poker/shared';
import { expect, test } from '@playwright/test';
import { createRoomViaApi } from './helpers/rooms';

/**
 * Guest identity end to end (PRD §3.1.2, FR-2): a name and a browser-stored participant id,
 * with no account and no call to NextAuth.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test.describe('guest identity', () => {
  test('remembers the name a guest typed, so the next room is prefilled', async ({
    page,
    request,
  }) => {
    const first = await createRoomViaApi(request);
    const second = await createRoomViaApi(request);

    await page.goto(`/join/${first.room.code}`);
    await page.getByTestId('join-name-input').fill('Khôi');
    await page.getByTestId('join-room-submit').click();
    await expect(page.getByTestId('participant-me')).toBeVisible();

    const participantId = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      PARTICIPANT_ID_STORAGE_KEY,
    );
    expect(participantId).toMatch(UUID);

    await page.goto(`/join/${second.room.code}`);
    await expect(page.getByTestId('join-name-input')).toHaveValue('Khôi');
  });

  test('keeps one seat per room and a different seat in each room', async ({ page, request }) => {
    const first = await createRoomViaApi(request);
    const second = await createRoomViaApi(request);

    for (const code of [first.room.code, second.room.code]) {
      await page.goto(`/join/${code}`);
      await page.getByTestId('join-name-input').fill('Khôi');
      await page.getByTestId('join-room-submit').click();
      await expect(page.getByTestId('participant-item')).toHaveCount(2);
    }

    const seats = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.endsWith(':participant-id')),
    );
    // One browser-wide identity plus one seat per room joined.
    expect(seats).toHaveLength(3);
  });

  test('never signs the guest in', async ({ page, request }) => {
    const { room } = await createRoomViaApi(request);

    await page.goto(`/join/${room.code}`);
    await page.getByTestId('join-name-input').fill('Khôi');
    await page.getByTestId('join-room-submit').click();
    await expect(page.getByTestId('participant-me')).toBeVisible();

    await page.goto('/');
    await expect(page.getByTestId('auth-status')).toContainText('Chưa đăng nhập');

    const cookies = await page.context().cookies();
    expect(
      cookies.find((cookie) => cookie.name.includes('next-auth.session-token')),
    ).toBeUndefined();
  });
});
