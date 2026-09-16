import { expect, type Page, test } from '@playwright/test';
import { createRoomViaApi } from './helpers/rooms';

/**
 * Lịch sử phiên end to end (PRD §4 step 9, FR-9, §9.6): sign in, run a room to a reveal, leave,
 * and find that session waiting in the history with the numbers it ended on.
 *
 * This is the only spec that signs anybody in, which is why `playwright.config.ts` hands both
 * servers the same `NEXTAUTH_SECRET`: the browser gets its session cookie from the web app and
 * the API has to be able to decrypt that very cookie to know whose history to return.
 */

/** A fresh account per test — the suite shares one database with everything else. */
function uniqueEmail(label: string): string {
  const slug =
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z]/g, '') || 'user';
  return `history-${slug}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

const PASSWORD = 'planning-poker-42';

/**
 * Registers through the real route. `/register` signs the new account in itself on a 201 and
 * lands on the home page, so there is nothing else to do; the login form is only a fallback for
 * the case where that sign-in did not take.
 */
async function signUpAndIn(page: Page, displayName: string): Promise<string> {
  const email = uniqueEmail(displayName);

  await page.goto('/register');
  await page.getByLabel('Tên hiển thị').fill(displayName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

  await page.waitForURL(/\/(login)?$/);
  if (page.url().endsWith('/login')) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu').fill(PASSWORD);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.waitForURL(/\/$/);
  }

  await expect(page.getByTestId('auth-status')).toContainText('Đã đăng nhập');
  return email;
}

function card(page: Page, value: string) {
  return page.locator(`[data-testid="vote-card"][data-value="${value}"]`);
}

test.describe('session history', () => {
  test('a signed-in host finds the room and its revealed round afterwards', async ({
    page,
    browser,
  }) => {
    await signUpAndIn(page, 'Khôi');

    // History is reachable only once there is a session — a guest never sees the way in.
    await expect(page.getByTestId('history-link')).toBeVisible();

    // --- the session itself: create, vote, reveal --------------------------------------
    const roomName = `Refinement ${Date.now()}`;
    await page.goto('/rooms/new');
    await page.getByTestId('room-name-input').fill(roomName);
    await page.getByTestId('create-room-submit').click();

    await expect(page.getByTestId('room-name')).toHaveText(roomName);
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');
    const code = (await page.getByTestId('room-code').textContent())?.trim() ?? '';
    expect(code).not.toBe('');

    // A guest joins so the round has two cards in it, and so the history has somebody in it
    // whose history this is not.
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    await guest.goto(`/join/${code}`);
    await guest.getByTestId('join-name-input').fill('Lan');
    await guest.getByTestId('join-room-submit').click();
    await expect(guest.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');

    await card(page, '5').click();
    await card(guest, '3').click();
    await page.getByTestId('reveal-button').click();
    await expect(page.getByTestId('results-average')).toHaveText('4');

    // --- step 9: leave, and come back to the history ------------------------------------
    await page.goto('/');
    await page.getByTestId('history-link').click();
    await expect(page).toHaveURL(/\/history$/);

    const entry = page.locator(`[data-testid="history-room"][data-room-code="${code}"]`);
    await expect(entry).toBeVisible();
    await expect(entry.getByTestId('history-room-name')).toHaveText(roomName);
    await expect(entry.getByTestId('history-room-participants')).toHaveText('2 người');
    await expect(entry.getByTestId('history-room-rounds')).toContainText('1 đã lộ bài');
    await expect(entry.getByTestId('history-room-revealed-at')).toContainText('Lộ bài gần nhất');

    // --- the drill-in: the round's own results, as the room saw them --------------------
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`/history/${code}$`));
    await expect(page.getByTestId('room-history-name')).toHaveText(roomName);
    await expect(page.getByTestId('room-history-participants')).toHaveText('2 người tham gia');

    const round = page.getByTestId('room-history-round');
    await expect(round).toHaveCount(1);
    await expect(round).toHaveAttribute('data-round-number', '1');
    await expect(round.getByTestId('round-revealed-at')).toContainText('Lộ bài lúc');
    // The same numbers the room ended on: 5 and 3 → average 4, median 4, no consensus.
    await expect(round.getByTestId('results-average')).toHaveText('4');
    await expect(round.getByTestId('results-median')).toHaveText('4');
    await expect(round.getByTestId('results-vote-count')).toHaveText('2');
    await expect(round.getByTestId('result-row')).toHaveCount(2);
    await expect(round.getByTestId('result-row').filter({ hasText: 'Lan' })).toContainText('3');

    await guestContext.close();
  });

  test('a guest has no way into history at all', async ({ page, request }) => {
    const { room } = await createRoomViaApi(request, { displayName: 'Khôi (host)' });

    await page.goto('/');
    // The entry point does not exist without an account (PRD §9.6).
    await expect(page.getByTestId('auth-status')).toContainText('Chưa đăng nhập');
    await expect(page.getByTestId('history-link')).toHaveCount(0);

    // Typing the URL gets a prompt to sign in, not somebody's sessions.
    await page.goto('/history');
    await expect(page.getByTestId('history-signed-out')).toBeVisible();
    await expect(page.getByTestId('history-list')).toHaveCount(0);

    // Nor does holding a room code open its archive.
    await page.goto(`/history/${room.code}`);
    await expect(page.getByTestId('room-history-error')).toContainText('đăng nhập');
    await expect(page.getByTestId('room-history-rounds')).toHaveCount(0);
  });

  test('a signed-in user who joined nothing sees an empty history', async ({ page }) => {
    await signUpAndIn(page, 'Mới');

    await page.goto('/history');
    await expect(page.getByTestId('history-empty')).toBeVisible();
    await expect(page.getByTestId('history-list')).toHaveCount(0);
  });

  test('a signed-in stranger cannot open somebody else’s room history', async ({
    page,
    request,
  }) => {
    // A room this account was never in: created by a guest, through the API.
    const { room } = await createRoomViaApi(request, { displayName: 'Người khác' });

    await signUpAndIn(page, 'Người lạ');
    await page.goto(`/history/${room.code}`);

    await expect(page.getByTestId('room-history-error')).toContainText('không tham gia');
    await expect(page.getByTestId('room-history-rounds')).toHaveCount(0);
  });
});
