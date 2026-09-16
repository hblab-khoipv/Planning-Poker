import type { RoundHistoryEntryDto } from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import {
  formatTimestamp,
  hasResults,
  summarizeRounds,
  votesByParticipantId,
} from './history-format';

function entry(overrides: Partial<RoundHistoryEntryDto> = {}): RoundHistoryEntryDto {
  return {
    round: {
      id: 'round-1',
      roundNumber: 1,
      status: 'revealed',
      createdAt: '2026-09-01T09:05:00.000Z',
      revealedAt: '2026-09-01T09:10:00.000Z',
    },
    votedParticipantIds: ['seat-1', 'seat-2'],
    votes: [
      { participantId: 'seat-1', value: '3' },
      { participantId: 'seat-2', value: '5' },
    ],
    tally: { voteCount: 2, numericCount: 2, average: 4, median: 4, consensus: false },
    ...overrides,
  };
}

describe('formatTimestamp', () => {
  it('renders a timestamp rather than an ISO string', () => {
    const formatted = formatTimestamp('2026-09-01T09:10:00.000Z');

    expect(formatted).not.toBe('2026-09-01T09:10:00.000Z');
    expect(formatted).toContain('2026');
  });

  // A malformed date must not render "Invalid Date" into the page.
  it('falls back to a dash for something that is not a date', () => {
    expect(formatTimestamp('not-a-date')).toBe('—');
  });
});

describe('summarizeRounds', () => {
  it('counts rounds and how many were revealed', () => {
    expect(summarizeRounds({ roundCount: 3, revealedRoundCount: 2 })).toBe('3 round · 2 đã lộ bài');
  });

  it('says so when a room has rounds but none were revealed', () => {
    expect(summarizeRounds({ roundCount: 2, revealedRoundCount: 0 })).toContain('chưa lộ bài');
  });

  it('handles a room with no rounds at all', () => {
    expect(summarizeRounds({ roundCount: 0, revealedRoundCount: 0 })).toBe('Chưa có round nào');
  });
});

describe('hasResults', () => {
  it('is true for a revealed round the server sent a tally for', () => {
    expect(hasResults(entry())).toBe(true);
  });

  /**
   * Keyed on the tally, not the status: if a payload ever claimed `revealed` without numbers,
   * the screen must not try to render results that are not there.
   */
  it('is false when there is no tally, whatever the status claims', () => {
    expect(hasResults(entry({ tally: null }))).toBe(false);
    expect(
      hasResults(
        entry({
          round: { ...entry().round, status: 'voting', revealedAt: null },
          votes: [],
          tally: null,
        }),
      ),
    ).toBe(false);
  });
});

describe('votesByParticipantId', () => {
  it('keys the cards by who played them', () => {
    expect([...votesByParticipantId(entry()).entries()]).toEqual([
      ['seat-1', '3'],
      ['seat-2', '5'],
    ]);
  });

  it('is empty for a round whose values were withheld', () => {
    expect(votesByParticipantId(entry({ votes: [], tally: null })).size).toBe(0);
  });
});
