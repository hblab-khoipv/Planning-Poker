import { expect, type Page, test } from '@playwright/test';
import { createRoomViaApi } from './helpers/rooms';

/**
 * PRD §4 steps 5–8, end to end, in real browsers: vote, reveal, read the results, start again.
 *
 * The host and the other participants are separate browser contexts rather than separate tabs,
 * so each has its own storage and its own seat — which is what makes "Lan cannot see Minh's card"
 * a real assertion instead of a statement about one page's React state.
 */

/** Joins the room as a guest and waits until the socket is live. */
async function joinAs(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/join/${code}`);
  await page.getByTestId('join-name-input').fill(name);
  await page.getByTestId('join-room-submit').click();
  await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');
}

function card(page: Page, value: string) {
  return page.locator(`[data-testid="vote-card"][data-value="${value}"]`);
}

function row(page: Page, name: string) {
  return page.getByTestId('participant-item').filter({ hasText: name });
}

test.describe('voting, reveal and a new round', () => {
  test('three people vote, the host reveals, and the next round starts clean', async ({
    page,
    request,
    browser,
  }) => {
    // The host creates the room through the API and then takes their seat in this browser, so
    // the seat this context holds really is the room's host seat.
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

    const minhContext = await browser.newContext();
    const minh = await minhContext.newPage();
    await joinAs(minh, room.code, 'Minh');

    await expect(page.getByTestId('participant-item')).toHaveCount(3);

    // Only the host sees the controls (FR-5); the others get the deck and nothing else.
    await expect(page.getByTestId('reveal-button')).toBeVisible();
    await expect(lan.getByTestId('host-controls')).toHaveCount(0);
    await expect(minh.getByTestId('host-controls')).toHaveCount(0);

    // --- step 5: everybody picks a card -------------------------------------------------
    await card(page, '2').click();
    await card(lan, '3').click();
    await card(minh, '8').click();

    // Each browser knows its own card...
    await expect(card(page, '2')).toHaveAttribute('data-selected', 'true');
    await expect(card(lan, '3')).toHaveAttribute('data-selected', 'true');

    // ...and every browser sees that the others have voted, without seeing what.
    for (const view of [page, lan, minh]) {
      await expect(view.getByTestId('participant-voted')).toHaveCount(3);
    }
    // FR-4: Lan's page has Minh's row, marked voted, and no card value anywhere on it.
    await expect(row(lan, 'Minh')).toHaveAttribute('data-voted', 'true');
    await expect(lan.getByTestId('participant-vote')).toHaveCount(0);
    await expect(lan.getByTestId('round-results')).toHaveCount(0);
    await expect(row(lan, 'Minh')).not.toContainText('8');

    // A vote can still be changed before the reveal (FR-4).
    await card(lan, '5').click();
    await expect(card(lan, '5')).toHaveAttribute('data-selected', 'true');
    await expect(card(lan, '3')).toHaveAttribute('data-selected', 'false');

    // --- step 6: the host reveals -------------------------------------------------------
    await page.getByTestId('reveal-button').click();

    // Every browser, not just the host's, shows the same values and the same numbers.
    for (const view of [page, lan, minh]) {
      await expect(view.getByTestId('round-status')).toHaveAttribute('data-state', 'revealed');
      await expect(view.getByTestId('round-results')).toBeVisible();
      // 2, 5 and 8 → average 5, median 5.
      await expect(view.getByTestId('results-average')).toHaveText('5');
      await expect(view.getByTestId('results-median')).toHaveText('5');
      await expect(view.getByTestId('results-consensus')).toHaveCount(0);
      await expect(view.getByTestId('result-row')).toHaveCount(3);
    }

    // The per-person table names names, on everybody's screen.
    await expect(minh.getByTestId('result-row').filter({ hasText: 'Lan' })).toContainText('5');
    await expect(minh.getByTestId('result-row').filter({ hasText: 'Khôi' })).toContainText('2');

    // The deck locks once the cards are up.
    await expect(lan.getByTestId('deck-locked')).toBeVisible();
    await expect(card(lan, '1')).toBeDisabled();

    // --- step 7/8: the host starts the next round ---------------------------------------
    await expect(page.getByTestId('revote-button')).toBeVisible();
    await page.getByTestId('new-round-button').click();

    for (const view of [page, lan, minh]) {
      await expect(view.getByTestId('round-number')).toHaveText('2');
      await expect(view.getByTestId('round-status')).toHaveAttribute('data-state', 'voting');
      // Every trace of round 1 is gone: no results, no values, nobody marked as having voted.
      await expect(view.getByTestId('round-results')).toHaveCount(0);
      await expect(view.getByTestId('participant-vote')).toHaveCount(0);
      await expect(view.getByTestId('participant-voted')).toHaveCount(0);
      await expect(view.getByTestId('participant-waiting')).toHaveCount(3);
    }
    // Including each browser's own selection.
    await expect(card(page, '2')).toHaveAttribute('data-selected', 'false');
    await expect(card(lan, '5')).toHaveAttribute('data-selected', 'false');

    // Round 2 reaches consensus, which round 1's values cannot influence.
    await card(page, '13').click();
    await card(lan, '13').click();
    await card(minh, '13').click();
    await page.getByTestId('reveal-button').click();

    for (const view of [page, lan, minh]) {
      await expect(view.getByTestId('results-consensus')).toBeVisible();
      await expect(view.getByTestId('results-average')).toHaveText('13');
      await expect(view.getByTestId('results-median')).toHaveText('13');
      await expect(view.getByTestId('results-vote-count')).toHaveText('3');
    }

    await lanContext.close();
    await minhContext.close();
  });

  test('a non-host gets no reveal or reset control at all', async ({ page, request, browser }) => {
    const { room } = await createRoomViaApi(request, { displayName: 'Khôi (host)' });

    const lanContext = await browser.newContext();
    const lan = await lanContext.newPage();
    await joinAs(lan, room.code, 'Lan');
    await card(lan, '8').click();
    await expect(lan.getByTestId('participant-voted')).toHaveCount(1);

    // No control for her anywhere on the page. Hiding the buttons is only the affordance; the
    // boundary is the server refusing the events, which
    // `apps/api/tests/integration/voting.test.ts` exercises by emitting them directly as a
    // non-host — something this page cannot do, since its socket is not exposed to the DOM.
    await expect(lan.getByTestId('host-controls')).toHaveCount(0);
    await expect(lan.getByTestId('reveal-button')).toHaveCount(0);
    await expect(lan.getByTestId('new-round-button')).toHaveCount(0);
    await expect(lan.getByTestId('revote-button')).toHaveCount(0);

    // The round is still open, and no values are on screen.
    await expect(lan.getByTestId('round-status')).toHaveAttribute('data-state', 'voting');
    await expect(lan.getByTestId('round-results')).toHaveCount(0);

    await page.goto(`/rooms/${room.code}`);
    await expect(page.getByTestId('room-not-joined')).toBeVisible();

    await lanContext.close();
  });

  test('a t-shirt room gets consensus without an average', async ({ page, request, browser }) => {
    const { room, participant } = await createRoomViaApi(request, {
      deckType: 'tshirt',
      displayName: 'Khôi (host)',
    });

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

    // The deck on screen is the room's own — there is no '13' to click in a t-shirt room.
    await expect(card(lan, 'M')).toBeVisible();
    await expect(card(lan, '13')).toHaveCount(0);

    await card(page, 'M').click();
    await card(lan, 'M').click();
    await page.getByTestId('reveal-button').click();

    for (const view of [page, lan]) {
      await expect(view.getByTestId('results-consensus')).toBeVisible();
      // FR-6 scopes average/median to numeric decks; a mean of sizes is not an estimate.
      await expect(view.getByTestId('results-summary')).toHaveCount(0);
      await expect(view.getByTestId('result-row')).toHaveCount(2);
    }

    await lanContext.close();
  });
});
