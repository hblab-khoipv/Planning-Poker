import { expect, type Page, test } from '@playwright/test';
import { createRoomViaApi } from './helpers/rooms';

/**
 * Thrown emoji, in two real browsers.
 *
 * The point of doing this end to end rather than in the integration suite is that "everybody
 * sees it" is a claim about two separate browser contexts — separate storage, separate seats,
 * separate sockets — and that a reaction changes nothing about the round it flies over.
 *
 * The emoji lives for `REACTION_TTL_MS`, so every assertion on one is made while it is in flight
 * and the disappearance is asserted afterwards.
 */

async function joinAs(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/join/${code}`);
  await page.getByTestId('join-name-input').fill(name);
  await page.getByTestId('join-room-submit').click();
  await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');
}

function emoji(page: Page, value: string) {
  return page.locator(`[data-testid="reaction-emoji"][data-emoji="${value}"]`);
}

function seat(page: Page, name: string) {
  return page.getByTestId('participant-item').filter({ hasText: name });
}

test.describe('throwing emoji in the room', () => {
  test('one participant throws, both browsers see it, and the round is untouched', async ({
    page,
    request,
    browser,
  }) => {
    const { room, participant } = await createRoomViaApi(request, { displayName: 'Khôi (host)' });

    await page.goto(`/rooms/${room.code}`);
    await page.evaluate(
      ([code, id]) =>
        window.localStorage.setItem(`planning-poker:room:${code}:participant-id`, id as string),
      [room.code, participant.id],
    );
    await page.reload();
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');

    const lanContext = await browser.newContext();
    const lan = await lanContext.newPage();
    await joinAs(lan, room.code, 'Lan');
    await expect(page.getByTestId('participant-item')).toHaveCount(2);

    // --- thrown at the table: it floats over the table on both screens -------------------
    await lan.locator('[data-testid="reaction-button"][data-emoji="🎉"]').click();

    await expect(page.getByTestId('table-reactions').locator('[data-emoji="🎉"]')).toBeVisible();
    await expect(lan.getByTestId('table-reactions').locator('[data-emoji="🎉"]')).toBeVisible();

    // It is ephemeral: it clears itself without anybody doing anything.
    await expect(emoji(page, '🎉')).toHaveCount(0, { timeout: 6000 });

    // --- thrown at a seat: it lands on that person's seat, on both screens ---------------
    // The target is the person, clicked at the table (captain 2026-10-08), not a dropdown.
    await seat(lan, 'Khôi (host)').getByTestId('seat-target').click();
    await lan.locator('[data-testid="reaction-button"][data-emoji="🍅"]').click();

    for (const view of [page, lan]) {
      await expect(seat(view, 'Khôi (host)').locator('[data-emoji="🍅"]')).toBeVisible();
      // ...and not over the table, which is the whole difference between the two throws.
      await expect(view.getByTestId('table-reactions').locator('[data-emoji="🍅"]')).toHaveCount(0);
    }

    // --- the round is exactly where it was ----------------------------------------------
    await expect(page.getByTestId('round-status')).toHaveAttribute('data-state', 'voting');
    await expect(page.getByTestId('participant-voted')).toHaveCount(0);

    // Voting still works with emoji flying, and the palette stays usable after the reveal —
    // reactions are the one control the round never locks.
    await page.locator('[data-testid="vote-card"][data-value="5"]').click();
    await expect(page.getByTestId('participant-voted')).toHaveCount(1);

    await page.getByTestId('reveal-button').click();
    await expect(page.getByTestId('round-status')).toHaveAttribute('data-state', 'revealed');

    await expect(page.getByTestId('reaction-bar')).toBeVisible();
    await page.locator('[data-testid="reaction-button"][data-emoji="🔥"]').click();
    await expect(lan.getByTestId('table-reactions').locator('[data-emoji="🔥"]')).toBeVisible();

    await lanContext.close();
  });
});
