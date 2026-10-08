import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { createRoomViaApi } from './helpers/rooms';

/**
 * A whole session, exported: two rounds with their own stories, then the CSV and the Markdown a
 * participant takes away.
 *
 * The download is the subject rather than the panel's markup, because the file is what leaves
 * the app: Playwright reads the saved bytes, so what is asserted is the artefact somebody opens
 * in Excel, not a React tree that happens to render the right numbers. It runs as a guest on
 * purpose — a guest-hosted room is the primary MVP flow, and the export has to work there.
 */

function card(page: Page, value: string) {
  return page.locator(`[data-testid="vote-card"][data-value="${value}"]`);
}

async function joinAs(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/join/${code}`);
  await page.getByTestId('join-name-input').fill(name);
  await page.getByTestId('join-room-submit').click();
  await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');
}

/** Clicks an export button and returns what the browser actually saved. */
async function downloadText(page: Page, testId: string): Promise<{ name: string; body: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('the browser saved no file');
  return { name: download.suggestedFilename(), body: await readFile(path, 'utf8') };
}

test.describe('round history and export', () => {
  test('two rounds are played, named, and exported as CSV and Markdown', async ({
    page,
    request,
    browser,
  }) => {
    const { room, participant } = await createRoomViaApi(request, {
      name: 'Sprint 42 refinement',
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

    // --- round 1 ------------------------------------------------------------------------
    await page.getByTestId('round-story-input').fill('Đăng nhập bằng Google');
    await page.getByTestId('round-story-input').blur();
    // The story reaches the other browser, which is not the host and so only reads it.
    await expect(lan.getByTestId('round-story')).toHaveText('Đăng nhập bằng Google');

    await card(page, '3').click();
    await card(lan, '5').click();
    await page.getByTestId('reveal-button').click();
    await expect(page.getByTestId('results-average')).toHaveText('4');

    // --- round 2 ------------------------------------------------------------------------
    await page.getByTestId('new-round-button').click();
    await expect(page.getByTestId('round-number')).toHaveText('2');
    // A new round starts unnamed rather than inheriting round 1's story.
    await expect(page.getByTestId('round-story-input')).toHaveValue('');

    await page.getByTestId('round-story-input').fill('Xuất báo cáo');
    await page.getByTestId('round-story-input').blur();
    await card(page, '8').click();
    await card(lan, '8').click();
    await page.getByTestId('reveal-button').click();
    await expect(page.getByTestId('results-consensus')).toBeVisible();

    // --- the history panel --------------------------------------------------------------
    // Collapsed until asked for, so it costs the room one line of height (the UI refresh work
    // relies on that). Lan is a guest, and opens it with the seat her own browser stored.
    await expect(lan.getByTestId('room-history-panel-rounds')).toHaveCount(0);
    await lan.getByTestId('room-history-toggle').click();
    await expect(lan.getByTestId('room-history-panel-round')).toHaveCount(2);
    await expect(lan.getByTestId('panel-round-story').first()).toHaveText('Đăng nhập bằng Google');
    await expect(lan.getByTestId('panel-round-consensus')).toHaveCount(1);

    // --- the export ---------------------------------------------------------------------
    const csv = await downloadText(lan, 'export-csv-button');
    expect(csv.name).toBe(`planning-poker-sprint-42-refinement-${room.code}.csv`);
    expect(csv.body).toContain('Round,Story,Trạng thái');
    // Round 1: two different cards averaging 4. Round 2: consensus on 8.
    expect(csv.body).toContain('1,Đăng nhập bằng Google,Đã lật bài,Khôi (host),3');
    expect(csv.body).toContain('1,Đăng nhập bằng Google,Đã lật bài,Lan,5');
    expect(csv.body).toContain('2,Xuất báo cáo,Đã lật bài,Lan,8');
    // Both rounds' numbers, as the room saw them.
    expect(csv.body).toContain(',4,4,Không,');
    expect(csv.body).toContain(',8,8,Có,');

    const markdown = await downloadText(lan, 'export-md-button');
    expect(markdown.name.endsWith('.md')).toBe(true);
    expect(markdown.body).toContain('# Sprint 42 refinement');
    expect(markdown.body).toContain('## Round 1 — Đăng nhập bằng Google');
    expect(markdown.body).toContain('## Round 2 — Xuất báo cáo');
    expect(markdown.body).toContain('| Lan | 5 |');
    expect(markdown.body).toContain('🎉 Đồng thuận');

    await lanContext.close();
  });

  /**
   * FR-4 does not lapse because a round is in a list. A round still being voted on shows up in
   * the panel as a row with no cards, and the export it feeds carries none either.
   */
  test('a round still being voted on is listed without its cards', async ({ page, request }) => {
    const { room, participant } = await createRoomViaApi(request, {
      name: 'Secrecy',
      displayName: 'Khôi',
    });

    await page.goto(`/rooms/${room.code}`);
    await page.evaluate(
      ([code, id]) =>
        window.localStorage.setItem(`planning-poker:room:${code}:participant-id`, id as string),
      [room.code, participant.id],
    );
    await page.reload();
    await expect(page.getByTestId('realtime-status')).toHaveAttribute('data-state', 'live');

    await card(page, '21').click();
    await expect(page.getByTestId('participant-voted')).toHaveCount(1);

    await page.getByTestId('room-history-toggle').click();
    await expect(page.getByTestId('room-history-panel-round')).toHaveCount(1);
    await expect(page.getByTestId('panel-round-hidden')).toBeVisible();

    const csv = await downloadText(page, 'export-csv-button');
    // The whole row, so the assertion is that the vote columns are *empty* rather than that
    // some string is missing: a timestamp can contain "21" by coincidence, a column cannot.
    expect(csv.body).toMatch(/\r\n1,,Chưa lật bài,,,,,,,,[^,\r\n]+,\r\n/);
    expect(csv.body).not.toContain('Khôi');
  });
});
