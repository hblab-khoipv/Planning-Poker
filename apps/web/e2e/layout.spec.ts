import { expect, type Page, test } from '@playwright/test';
import { createRoomViaApi } from './helpers/rooms';

/**
 * The room screen has to fit a laptop without a page scroll — the captain's second ask, and the
 * one rule that a stylesheet edit can silently break. It is asserted the only way a viewer would
 * notice it: the document is no taller than the window it is being shown in.
 *
 * Both the voting and the revealed state are measured, because revealing adds the results panel
 * and that is exactly where the old layout ran off the bottom. Mobile is measured too, for the
 * other half of the rule: scrolling down is fine there, scrolling *sideways* is not.
 */
const DESKTOP = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
];

async function seatHost(page: Page, code: string, participantId: string): Promise<void> {
  await page.goto(`/rooms/${code}`);
  await page.evaluate(
    ([roomCode, id]) =>
      window.localStorage.setItem(`planning-poker:room:${roomCode}:participant-id`, id as string),
    [code, participantId],
  );
  await page.reload();
  await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');
}

/** How far the page could be scrolled vertically. 0 means everything is already on screen. */
function verticalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
}

test.describe('the room screen fits one laptop screen', () => {
  for (const viewport of DESKTOP) {
    test(`no page scroll while voting or after the reveal at ${viewport.name}`, async ({
      page,
      request,
    }) => {
      const { room, participant } = await createRoomViaApi(request, { displayName: 'Khôi (host)' });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seatHost(page, room.code, participant.id);

      await expect(page.getByTestId('room-screen')).toBeVisible();
      expect(await verticalOverflow(page)).toBeLessThanOrEqual(1);

      await page.locator('[data-testid="vote-card"][data-value="5"]').click();
      await page.getByTestId('reveal-button').click();
      await expect(page.getByTestId('round-results')).toBeVisible();

      // The results panel is the state that used to push the deck off the bottom.
      expect(await verticalOverflow(page)).toBeLessThanOrEqual(1);
    });
  }

  test('no sideways scroll on a phone', async ({ page, request }) => {
    const { room, participant } = await createRoomViaApi(request, { displayName: 'Khôi (host)' });
    await page.setViewportSize({ width: 390, height: 844 });
    await seatHost(page, room.code, participant.id);

    await expect(page.getByTestId('room-screen')).toBeVisible();
    const horizontal = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontal).toBeLessThanOrEqual(1);
  });
});
