import { expect, test } from '@playwright/test';
import { createRoomViaApi } from './helpers/rooms';

/**
 * The flow PRD §4 describes, through the browser: create a room, take the link to a second
 * visitor, have them join as a guest, and see both people in the participant list (FR-1..FR-3).
 */

test.describe('create a room', () => {
  test('takes the host from the form into their own room', async ({ page }) => {
    await page.goto('/rooms/new');

    await page.getByTestId('room-name-input').fill('Sprint 42 refinement');
    await page.getByTestId('deck-option-tshirt').check();
    await page.getByTestId('host-name-input').fill('Khôi (host)');
    await page.getByTestId('create-room-submit').click();

    await expect(page).toHaveURL(/\/rooms\/[0-9A-HJKMNPQRSTVWXYZ]{8}$/);
    await expect(page.getByTestId('room-name')).toHaveText('Sprint 42 refinement');
    await expect(page.getByTestId('room-deck-type')).toHaveText('tshirt');

    // The host is seated by creating the room; they do not have to join their own room.
    await expect(page.getByTestId('participant-item')).toHaveCount(1);
    await expect(page.getByTestId('participant-list')).toContainText('Khôi (host)');
    await expect(page.getByTestId('room-not-joined')).toHaveCount(0);

    const inviteLink = await page.getByTestId('invite-link').inputValue();
    const code = await page.getByTestId('room-code').innerText();
    expect(inviteLink).toContain(`/rooms/${code}`);
  });

  test('will not create a room without a name', async ({ page }) => {
    await page.goto('/rooms/new');

    await page.getByTestId('host-name-input').fill('Khôi');
    await page.getByTestId('create-room-submit').click();

    // The form stays put; nothing was created.
    await expect(page).toHaveURL(/\/rooms\/new$/);
  });
});

test.describe('join a room', () => {
  test('a guest opening the invite link joins and appears in the list', async ({
    page,
    request,
  }) => {
    const { room } = await createRoomViaApi(request, {
      name: 'Sprint 42 refinement',
      displayName: 'Khôi (host)',
    });

    // A visitor who was sent the link but has not joined sees the room, and a prompt to join.
    await page.goto(`/rooms/${room.code}`);
    await expect(page.getByTestId('room-name')).toHaveText('Sprint 42 refinement');
    await expect(page.getByTestId('room-not-joined')).toBeVisible();
    await expect(page.getByTestId('participant-item')).toHaveCount(1);

    await page.getByTestId('room-not-joined').getByRole('link', { name: 'Vào phòng' }).click();
    await expect(page).toHaveURL(new RegExp(`/join/${room.code}$`));
    await expect(page.getByTestId('join-room-name')).toHaveText('Sprint 42 refinement');

    await page.getByTestId('join-name-input').fill('Lan (khách)');
    await page.getByTestId('join-room-submit').click();

    await expect(page).toHaveURL(new RegExp(`/rooms/${room.code}$`));
    await expect(page.getByTestId('participant-item')).toHaveCount(2);
    await expect(page.getByTestId('participant-list')).toContainText('Khôi (host)');
    await expect(page.getByTestId('participant-list')).toContainText('Lan (khách)');
    await expect(page.getByTestId('participant-me')).toBeVisible();
    await expect(page.getByTestId('room-not-joined')).toHaveCount(0);
  });

  test('reloading the room does not take a second seat', async ({ page, request }) => {
    const { room } = await createRoomViaApi(request);

    await page.goto(`/join/${room.code}`);
    await page.getByTestId('join-name-input').fill('Lan');
    await page.getByTestId('join-room-submit').click();
    await expect(page.getByTestId('participant-item')).toHaveCount(2);

    await page.reload();
    await expect(page.getByTestId('participant-item')).toHaveCount(2);

    // Joining again from the same browser reuses the stored seat rather than adding one.
    await page.goto(`/join/${room.code}`);
    await page.getByTestId('join-room-submit').click();
    await expect(page.getByTestId('participant-item')).toHaveCount(2);
  });

  test('the list picks up somebody else joining, without a reload', async ({
    page,
    request,
    browser,
  }) => {
    const { room } = await createRoomViaApi(request, { displayName: 'Khôi (host)' });

    await page.goto(`/join/${room.code}`);
    await page.getByTestId('join-name-input').fill('Lan');
    await page.getByTestId('join-room-submit').click();
    await expect(page.getByTestId('participant-item')).toHaveCount(2);

    // A different browser context is a different guest: separate localStorage, separate seat.
    const second = await browser.newContext();
    const otherPage = await second.newPage();
    await otherPage.goto(`/join/${room.code}`);
    await otherPage.getByTestId('join-name-input').fill('Minh');
    await otherPage.getByTestId('join-room-submit').click();
    await expect(otherPage.getByTestId('participant-item')).toHaveCount(3);

    // The first tab holds a room socket, so participant:joined lands without a reload
    // (realtime.spec.ts is where that is pinned down properly).
    await expect(page.getByTestId('participant-list')).toContainText('Minh');
    await expect(page.getByTestId('participant-item')).toHaveCount(3);

    await second.close();
  });

  test('says so when the code does not belong to any room', async ({ page }) => {
    await page.goto('/join/ZZ99ZZ99');

    await expect(page.getByTestId('join-room-error')).toContainText('Không tìm thấy phòng');
  });

  test('refuses to seat a guest with no name', async ({ page, request }) => {
    const { room } = await createRoomViaApi(request);

    await page.goto(`/join/${room.code}`);
    await expect(page.getByTestId('join-room-name')).toBeVisible();
    await page.getByTestId('join-name-input').fill('   ');
    await page.getByTestId('join-room-submit').click();

    await expect(page).toHaveURL(new RegExp(`/join/${room.code}$`));
  });
});
