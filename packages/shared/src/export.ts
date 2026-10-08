import type { RoomDto } from './rooms.js';
import type { RoomHistoryDetailResponse, RoundHistoryEntryDto } from './history.js';

/**
 * Turning a room's round history into a file somebody can keep (PRD §11's "Export kết quả ra
 * file (CSV/Excel)", pulled forward from the out-of-scope list — see issue on the repo).
 *
 * These are pure functions over exactly the payload `GET /rooms/:code/rounds` already returns,
 * and they live in `packages/shared` for the usual reason: the numbers in an exported file must
 * be the same numbers the room saw, so the export reads the server's `tally` rather than
 * recomputing one. Nothing here can widen what the caller may see either — a round the server
 * withheld (FR-4: never revealed) arrives with `votes: []` and `tally: null`, and prints as
 * "chưa lật bài" with no cards.
 */

/** Columns of the CSV, in order. Vietnamese, because every other user-facing string is. */
export const CSV_HEADERS = [
  'Round',
  'Story',
  'Trạng thái',
  'Người tham gia',
  'Lá bài',
  'Bài ban đầu',
  'Đã sửa',
  'Trung bình',
  'Median',
  'Đồng thuận',
  'Bắt đầu',
  'Lật bài',
] as const;

/**
 * One line per vote rather than one column per participant.
 *
 * A wide layout would need a column per seat, which changes shape when somebody joins halfway
 * through a session — so two exports of the same room could not be compared, and a spreadsheet
 * could not stack several rooms. Long format costs a repeated round number and buys a file that
 * pivots.
 */
export interface RoomExportRow {
  roundNumber: number;
  story: string;
  status: string;
  participant: string;
  value: string;
  originalValue: string;
  edited: string;
  average: string;
  median: string;
  consensus: string;
  createdAt: string;
  revealedAt: string;
}

const STATUS_LABELS = { voting: 'Chưa lật bài', revealed: 'Đã lật bài' } as const;

function numberCell(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * The rows of the export, shared by both formats so the CSV and the Markdown summary can never
 * disagree about what happened in a round.
 *
 * A round nobody voted in still produces one row: "round 3 happened and was empty" is a fact
 * about the session, and dropping it would renumber the file against the room.
 */
export function roomExportRows(detail: RoomHistoryDetailResponse): RoomExportRow[] {
  const names = new Map(detail.participants.map((seat) => [seat.id, seat.displayName]));
  const rows: RoomExportRow[] = [];

  for (const entry of detail.rounds) {
    const shared = {
      roundNumber: entry.round.roundNumber,
      story: entry.round.story ?? '',
      status: STATUS_LABELS[entry.round.status],
      average: numberCell(entry.tally?.average ?? null),
      median: numberCell(entry.tally?.median ?? null),
      consensus: entry.tally === null ? '' : entry.tally.consensus ? 'Có' : 'Không',
      createdAt: entry.round.createdAt,
      revealedAt: entry.round.revealedAt ?? '',
    };

    if (entry.votes.length === 0) {
      rows.push({
        ...shared,
        participant: '',
        value: '',
        originalValue: '',
        edited: '',
      });
      continue;
    }

    for (const vote of entry.votes) {
      rows.push({
        ...shared,
        participant: names.get(vote.participantId) ?? vote.participantId,
        value: vote.value,
        originalValue: vote.originalValue ?? '',
        edited: vote.editedAt ? 'Có' : '',
      });
    }
  }

  return rows;
}

/**
 * One CSV field.
 *
 * Quoting is not only about commas: a cell starting with `=`, `+`, `-` or `@` is executed as a
 * formula when a spreadsheet opens the file, and a story title is free text somebody else typed.
 * Prefixing those with a tab neutralises them while still displaying the original text.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `\t${value}` : value;
  if (!/["\n\r,\t]/.test(guarded)) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Excel reads a BOM-less UTF-8 CSV as mojibake — "Trung bình" becomes "Trung bÃ¬nh". */
export const UTF8_BOM = '\uFEFF';

/**
 * The CSV file itself.
 *
 * CRLF as well as the BOM, both for Excel: without CRLF it merges the rows of a quoted
 * multi-line cell. Neither bothers any other reader.
 */
export function roomSummaryCsv(detail: RoomHistoryDetailResponse): string {
  const lines = [
    CSV_HEADERS.map(csvCell).join(','),
    ...roomExportRows(detail).map((row) =>
      [
        String(row.roundNumber),
        row.story,
        row.status,
        row.participant,
        row.value,
        row.originalValue,
        row.edited,
        row.average,
        row.median,
        row.consensus,
        row.createdAt,
        row.revealedAt,
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/** Escapes the one character that would break a Markdown table cell. */
function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function roundHeading(entry: RoundHistoryEntryDto): string {
  const story = entry.round.story;
  return story ? `Round ${entry.round.roundNumber} — ${story}` : `Round ${entry.round.roundNumber}`;
}

/**
 * The same session as something a person can paste into a ticket or a chat thread.
 *
 * Deliberately not the CSV with different punctuation: this one is read rather than pivoted, so
 * it leads with each round's result and lists the cards under it. A round that was never
 * revealed says so instead of showing an empty table, which is the same thing the history screen
 * does with the same payload.
 */
export function roomSummaryMarkdown(detail: RoomHistoryDetailResponse): string {
  const names = new Map(detail.participants.map((seat) => [seat.id, seat.displayName]));
  const parts: string[] = [
    `# ${detail.room.name}`,
    '',
    `- Mã phòng: \`${detail.room.code}\``,
    `- Bộ thẻ: ${detail.room.deckType}`,
    `- Người tham gia: ${detail.participants.map((seat) => seat.displayName).join(', ') || '—'}`,
    `- Số round: ${detail.rounds.length}`,
    '',
  ];

  if (detail.rounds.length === 0) {
    parts.push('_Phòng này chưa có round nào._', '');
    return parts.join('\n');
  }

  for (const entry of detail.rounds) {
    parts.push(`## ${roundHeading(entry)}`, '');

    if (entry.tally === null) {
      parts.push('_Round này chưa lật bài, các lá bài vẫn được giữ kín._', '');
      continue;
    }

    const stats = [
      entry.tally.average === null ? null : `Trung bình **${entry.tally.average}**`,
      entry.tally.median === null ? null : `Median **${entry.tally.median}**`,
      `${entry.tally.voteCount} lượt vote`,
      entry.tally.consensus ? '🎉 Đồng thuận' : null,
    ].filter((part): part is string => part !== null);

    parts.push(stats.join(' · '), '', '| Người tham gia | Lá bài |', '| --- | --- |');
    for (const vote of entry.votes) {
      const card = vote.originalValue ? `~~${vote.originalValue}~~ → ${vote.value}` : vote.value;
      parts.push(`| ${mdCell(names.get(vote.participantId) ?? vote.participantId)} | ${card} |`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/** A file name that sorts by room and does not depend on the browser's download folder rules. */
export function roomSummaryFileName(room: RoomDto, extension: 'csv' | 'md'): string {
  const slug = room.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `planning-poker-${slug || 'room'}-${room.code}.${extension}`;
}
