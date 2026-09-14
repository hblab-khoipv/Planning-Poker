import { expect, test } from '@playwright/test';
import { createRoomViaApi } from './helpers/rooms';

/**
 * FR-3 through two real browsers: the participant list is pushed, not polled.
 *
 * Every assertion here is about a page nobody reloaded. Playwright's auto-waiting would happily
 * hide a slow poll behind a passing assertion, so the specs pin the things only a socket can do
 * — the realtime badge going "Trực tiếp", and a seat flipping to "Ngoại tuyến" when the other
 * browser closes rather than disappearing or going stale.
 */

test.describe('realtime participant list', () => {
  test('two browsers in one room see each other join, live', async ({ page, request, browser }) => {
    const { room } = await createRoomViaApi(request, { displayName: 'Khôi (host)' });

    await page.goto(`/join/${room.code}`);
    await page.getByTestId('join-name-input').fill('Lan');
    await page.getByTestId('join-room-submit').click();

    // A seat means a socket: the badge only reads "Trực tiếp" once the handshake succeeded.
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');
    await expect(page.getByTestId('participant-item')).toHaveCount(2);

    const second = await browser.newContext();
    const otherPage = await second.newPage();
    await otherPage.goto(`/join/${room.code}`);
    await otherPage.getByTestId('join-name-input').fill('Minh');
    await otherPage.getByTestId('join-room-submit').click();
    await expect(otherPage.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');

    // The first tab was never reloaded and is not polling; this can only be participant:joined.
    await expect(page.getByTestId('participant-list')).toContainText('Minh');
    await expect(page.getByTestId('participant-item')).toHaveCount(3);

    // ...and the newcomer's own snapshot has everybody who was already there.
    await expect(otherPage.getByTestId('participant-item')).toHaveCount(3);
    await expect(otherPage.getByTestId('participant-list')).toContainText('Khôi (host)');
    await expect(otherPage.getByTestId('participant-list')).toContainText('Lan');

    // Minh has a live socket, so their seat reads online in both browsers.
    const minhInFirstTab = page.getByTestId('participant-item').filter({ hasText: 'Minh' });
    await expect(minhInFirstTab).toHaveAttribute('data-online', 'true');
    await expect(
      otherPage.getByTestId('participant-item').filter({ hasText: 'Minh' }),
    ).toHaveAttribute('data-online', 'true');

    await second.close();

    // A closed browser is a departure once the grace window passes: the seat stays in the list
    // (it will still hold a vote in task 6) and is marked offline instead of vanishing.
    await expect(minhInFirstTab).toHaveAttribute('data-online', 'false', { timeout: 20_000 });
    await expect(minhInFirstTab.getByTestId('participant-offline')).toBeVisible();
    await expect(page.getByTestId('participant-item')).toHaveCount(3);
  });

  test('somebody who has not joined gets the list read-only, with no realtime badge', async ({
    page,
    request,
  }) => {
    const { room } = await createRoomViaApi(request, { displayName: 'Khôi (host)' });

    await page.goto(`/rooms/${room.code}`);

    await expect(page.getByTestId('room-not-joined')).toBeVisible();
    await expect(page.getByTestId('participant-item')).toHaveCount(1);
    // No seat, so the API refuses a socket and the page never claims to be live.
    await expect(page.getByTestId('realtime-status')).toHaveCount(0);
  });
});
