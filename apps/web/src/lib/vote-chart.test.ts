import type { RevealedVoteDto } from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import { describeChart, voteChartBars } from './vote-chart';

/**
 * Issue #12's chart, as numbers. A bar chart is only an improvement on the old list if its bars
 * are right, and heights are exactly the kind of thing a visual review cannot check.
 */

function vote(participantId: string, value: string, edit?: string): RevealedVoteDto {
  return {
    participantId,
    value,
    originalValue: edit ?? null,
    editedAt: edit ? '2026-09-15T10:00:00.000Z' : null,
  };
}

describe('voteChartBars', () => {
  it('counts one bar per card that was actually played', () => {
    const bars = voteChartBars('fibonacci', [vote('a', '5'), vote('b', '8'), vote('c', '8')]);

    expect(bars.map((bar) => [bar.value, bar.count])).toEqual([
      ['5', 1],
      ['8', 2],
    ]);
  });

  it('leaves out cards nobody chose rather than drawing empty air', () => {
    const bars = voteChartBars('fibonacci', [vote('a', '13')]);

    expect(bars).toHaveLength(1);
    expect(bars[0]?.value).toBe('13');
  });

  it('keeps the deck order, so a split between 3 and 13 does not look like 3 and 5', () => {
    const bars = voteChartBars('fibonacci', [
      vote('a', '13'),
      vote('b', '2'),
      vote('c', '?'),
      vote('d', '5'),
    ]);

    expect(bars.map((bar) => bar.value)).toEqual(['2', '5', '13', '?']);
  });

  it('orders a t-shirt deck by size rather than alphabetically', () => {
    const bars = voteChartBars('tshirt', [vote('a', 'XL'), vote('b', 'S'), vote('c', 'M')]);

    expect(bars.map((bar) => bar.value)).toEqual(['S', 'M', 'XL']);
  });

  it('measures each bar against the tallest, so the winner reaches the top', () => {
    const bars = voteChartBars('fibonacci', [vote('a', '3'), vote('b', '5'), vote('c', '5')]);

    expect(bars.find((bar) => bar.value === '5')?.ratio).toBe(1);
    expect(bars.find((bar) => bar.value === '3')?.ratio).toBe(0.5);
  });

  it('marks every card that ties for most-played', () => {
    const bars = voteChartBars('fibonacci', [vote('a', '3'), vote('b', '5')]);

    expect(bars.every((bar) => bar.isMode)).toBe(true);
  });

  it('names the voters behind each bar', () => {
    const names = new Map([
      ['a', 'Lan'],
      ['b', 'Minh'],
    ]);
    const bars = voteChartBars('fibonacci', [vote('a', '5'), vote('b', '5')], names);

    expect(bars[0]?.voters).toEqual(['Lan', 'Minh']);
  });

  it('falls back to the participant id when a seat has left the room', () => {
    const bars = voteChartBars('fibonacci', [vote('ghost', '5')]);

    expect(bars[0]?.voters).toEqual(['ghost']);
  });

  it('charts the card as it stands now, not the one an edit replaced (issue #11)', () => {
    const bars = voteChartBars('fibonacci', [vote('a', '3', '8')]);

    expect(bars.map((bar) => [bar.value, bar.count])).toEqual([['3', 1]]);
  });

  it('has nothing to draw for a round nobody voted in', () => {
    expect(voteChartBars('fibonacci', [])).toEqual([]);
  });

  it('puts a card the room deck no longer contains at the end instead of first', () => {
    const bars = voteChartBars('tshirt', [vote('a', 'M'), vote('b', '13')]);

    expect(bars.map((bar) => bar.value)).toEqual(['M', '13']);
  });
});

describe('describeChart', () => {
  it('reads the whole distribution as one sentence', () => {
    const bars = voteChartBars('fibonacci', [vote('a', '3'), vote('b', '5'), vote('c', '5')]);

    expect(describeChart(bars)).toBe('3: 1 vote, 5: 2 vote');
  });

  it('says so when there is nothing to describe', () => {
    expect(describeChart([])).toBe('Chưa có lượt vote nào.');
  });
});
