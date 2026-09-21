import type { RevealedVoteDto, RoundHistoryEntryDto } from '@planning-poker/shared';

/**
 * Presentation rules for the history screens (PRD §9.6), kept out of the components so they can
 * be asserted directly rather than through a rendered tree.
 */

/**
 * A timestamp as somebody reading a list of past meetings wants it: day and time, local zone.
 *
 * `undefined` as the locale means "whatever the browser is set to". The server never renders
 * these — both history screens are client components — so there is no server/client mismatch to
 * hydrate around.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** What the list card says about a room's rounds, including the "nothing revealed" case. */
export function summarizeRounds(entry: { roundCount: number; revealedRoundCount: number }): string {
  if (entry.roundCount === 0) return 'Chưa có round nào';
  if (entry.revealedRoundCount === 0) return `${entry.roundCount} round · chưa lật bài round nào`;
  return `${entry.roundCount} round · ${entry.revealedRoundCount} đã lật bài`;
}

/**
 * Whether a history entry has results to show.
 *
 * Reads `tally` rather than `round.status`, because the tally is the thing being rendered and
 * the server only ever fills it in for a revealed round. Trusting the status instead would mean
 * the screen could decide to show results for a payload that has none.
 */
export function hasResults(
  entry: RoundHistoryEntryDto,
): entry is RoundHistoryEntryDto & { tally: NonNullable<RoundHistoryEntryDto['tally']> } {
  return entry.tally !== null;
}

/**
 * Cards keyed by the participant who played them, for a revealed round.
 *
 * The whole vote rather than its value, for the same reason as the live room's
 * `votesByParticipant`: since issue #11 a card may carry the one it replaced, and a past meeting
 * is exactly where "she changed her estimate after we all showed" is worth still being able to see.
 */
export function votesByParticipantId(entry: RoundHistoryEntryDto): Map<string, RevealedVoteDto> {
  return new Map(entry.votes.map((vote) => [vote.participantId, vote]));
}
