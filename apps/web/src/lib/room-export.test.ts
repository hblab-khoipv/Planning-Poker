import {
  csvCell,
  CSV_HEADERS,
  type ParticipantDto,
  type RoomHistoryDetailResponse,
  type RoundHistoryEntryDto,
  roomExportRows,
  roomSummaryCsv,
  roomSummaryFileName,
  roomSummaryMarkdown,
  UTF8_BOM,
} from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import { roomSummaryFile } from './room-export';

/**
 * What an exported summary actually contains.
 *
 * The formatters live in `packages/shared` (so the API could serve the same bytes) but the
 * browser is their only caller, so they are asserted here beside the download glue that uses
 * them. The assertions that matter most are the negative ones: a round the server withheld
 * because it was never revealed must not acquire cards on the way into a file.
 */

function seat(id: string, displayName: string): ParticipantDto {
  return {
    id,
    displayName,
    isGuest: true,
    isHost: false,
    isOnline: true,
    joinedAt: '2026-09-01T09:00:00.000Z',
  };
}

function revealedRound(
  overrides: Partial<RoundHistoryEntryDto['round']> = {},
): RoundHistoryEntryDto {
  return {
    round: {
      id: 'round-1',
      roundNumber: 1,
      status: 'revealed',
      story: 'Đăng nhập bằng Google',
      createdAt: '2026-09-01T09:05:00.000Z',
      revealedAt: '2026-09-01T09:10:00.000Z',
      ...overrides,
    },
    votedParticipantIds: ['seat-1', 'seat-2'],
    votes: [
      { participantId: 'seat-1', value: '3', originalValue: null, editedAt: null },
      { participantId: 'seat-2', value: '5', originalValue: null, editedAt: null },
    ],
    tally: { voteCount: 2, numericCount: 2, average: 4, median: 4, consensus: false },
  };
}

/** A round abandoned mid-vote: the server sends no cards and no tally for it (FR-4). */
function hiddenRound(): RoundHistoryEntryDto {
  return {
    round: {
      id: 'round-2',
      roundNumber: 2,
      status: 'voting',
      story: null,
      createdAt: '2026-09-01T09:20:00.000Z',
      revealedAt: null,
    },
    votedParticipantIds: ['seat-1'],
    votes: [],
    tally: null,
  };
}

function detail(rounds: RoundHistoryEntryDto[]): RoomHistoryDetailResponse {
  return {
    room: {
      id: 'room-1',
      code: 'AB12CD34',
      name: 'Sprint 42 refinement',
      deckType: 'fibonacci',
      hostId: null,
      hostParticipantId: 'seat-1',
      createdAt: '2026-09-01T09:00:00.000Z',
    },
    participants: [seat('seat-1', 'Khôi'), seat('seat-2', 'Lan')],
    rounds,
  };
}

describe('roomExportRows', () => {
  it('writes one row per vote, repeating the round so the file pivots', () => {
    const rows = roomExportRows(detail([revealedRound()]));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.roundNumber, row.participant, row.value])).toEqual([
      [1, 'Khôi', '3'],
      [1, 'Lan', '5'],
    ]);
    expect(rows[0]).toMatchObject({
      story: 'Đăng nhập bằng Google',
      status: 'Đã lật bài',
      average: '4',
      median: '4',
      consensus: 'Không',
    });
  });

  it('keeps a round nobody revealed, with no cards and no numbers', () => {
    const rows = roomExportRows(detail([hiddenRound()]));

    expect(rows).toEqual([
      expect.objectContaining({
        roundNumber: 2,
        status: 'Chưa lật bài',
        participant: '',
        value: '',
        average: '',
        median: '',
        consensus: '',
        revealedAt: '',
      }),
    ]);
  });

  it('carries issue #11 edit evidence into the export', () => {
    const entry = revealedRound();
    entry.votes[0] = {
      participantId: 'seat-1',
      value: '8',
      originalValue: '3',
      editedAt: '2026-09-01T09:12:00.000Z',
    };

    expect(roomExportRows(detail([entry]))[0]).toMatchObject({
      value: '8',
      originalValue: '3',
      edited: 'Có',
    });
  });

  it('marks a unanimous round as consensus', () => {
    const entry = revealedRound();
    entry.tally = { voteCount: 2, numericCount: 2, average: 5, median: 5, consensus: true };

    expect(roomExportRows(detail([entry]))[0]?.consensus).toBe('Có');
  });
});

describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Khôi')).toBe('Khôi');
  });

  it('quotes and doubles up embedded quotes', () => {
    expect(csvCell('story "A", phần 2')).toBe('"story ""A"", phần 2"');
  });

  it('neutralises a cell a spreadsheet would run as a formula', () => {
    // The text still reads the same to a person; it just no longer starts a formula.
    expect(csvCell('=SUM(A1:A9)')).toBe('"\t=SUM(A1:A9)"');
  });

  it.each(['=cmd', '+1', '-1', '@ref'])('guards the formula trigger %j', (value) => {
    expect(csvCell(value).startsWith('"\t')).toBe(true);
  });
});

describe('roomSummaryCsv', () => {
  const csv = roomSummaryCsv(detail([revealedRound(), hiddenRound()]));

  it('opens with a BOM and the Vietnamese header row', () => {
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv.split('\r\n')[0]).toBe(`${UTF8_BOM}${CSV_HEADERS.join(',')}`);
  });

  it('uses CRLF so Excel does not merge rows', () => {
    expect(csv.split('\r\n').filter((line) => line.length > 0)).toHaveLength(4);
  });

  it('contains every revealed card and the round that was never revealed', () => {
    expect(csv).toContain('Khôi');
    expect(csv).toContain('Đăng nhập bằng Google');
    expect(csv).toContain('Chưa lật bài');
  });
});

describe('roomSummaryMarkdown', () => {
  it('leads with the room, then each round and its result', () => {
    const md = roomSummaryMarkdown(detail([revealedRound()]));

    expect(md).toContain('# Sprint 42 refinement');
    expect(md).toContain('`AB12CD34`');
    expect(md).toContain('## Round 1 — Đăng nhập bằng Google');
    expect(md).toContain('Trung bình **4**');
    expect(md).toContain('| Khôi | 3 |');
  });

  it('says a round was never revealed instead of printing an empty table', () => {
    const md = roomSummaryMarkdown(detail([hiddenRound()]));

    expect(md).toContain('## Round 2');
    expect(md).toContain('chưa lật bài');
    expect(md).not.toContain('| Khôi |');
  });

  it('shows an edited card as the one it replaced', () => {
    const entry = revealedRound();
    entry.votes[0] = {
      participantId: 'seat-1',
      value: '8',
      originalValue: '3',
      editedAt: '2026-09-01T09:12:00.000Z',
    };

    expect(roomSummaryMarkdown(detail([entry]))).toContain('| Khôi | ~~3~~ → 8 |');
  });

  it('handles a room with no rounds at all', () => {
    expect(roomSummaryMarkdown(detail([]))).toContain('chưa có round nào');
  });
});

describe('roomSummaryFileName', () => {
  it('slugs the room name and keeps the code, so two rooms never collide', () => {
    expect(roomSummaryFileName(detail([]).room, 'csv')).toBe(
      'planning-poker-sprint-42-refinement-AB12CD34.csv',
    );
  });

  it('falls back to "room" when the name slugs away to nothing', () => {
    const room = { ...detail([]).room, name: '⚡️⚡️' };
    expect(roomSummaryFileName(room, 'md')).toBe('planning-poker-room-AB12CD34.md');
  });

  it('strips Vietnamese diacritics rather than percent-encoding them', () => {
    const room = { ...detail([]).room, name: 'Ước lượng sprint' };
    expect(roomSummaryFileName(room, 'csv')).toBe('planning-poker-uoc-luong-sprint-AB12CD34.csv');
  });
});

describe('roomSummaryFile', () => {
  it('labels the CSV with a charset, or Excel mangles the headers', () => {
    const file = roomSummaryFile(detail([revealedRound()]), 'csv');

    expect(file.mimeType).toBe('text/csv;charset=utf-8');
    expect(file.fileName.endsWith('.csv')).toBe(true);
    expect(file.content).toContain('Trung bình');
  });

  it('produces the Markdown summary for the copy button', () => {
    const file = roomSummaryFile(detail([revealedRound()]), 'md');

    expect(file.mimeType).toBe('text/markdown;charset=utf-8');
    expect(file.content.startsWith('# Sprint 42 refinement')).toBe(true);
  });
});
