import type { RoundTally } from './tally.js';

/** Lifecycle of a voting round (PRD §7 `voting_rounds.status`, §8 `round:reset`). */
export const ROUND_STATUSES = ['voting', 'revealed'] as const;

export type RoundStatus = (typeof ROUND_STATUSES)[number];

export function isRoundStatus(value: unknown): value is RoundStatus {
  return typeof value === 'string' && (ROUND_STATUSES as readonly string[]).includes(value);
}

/** The wire shape of a `voting_rounds` row. Dates are ISO strings: JSON has no date type. */
export interface RoundDto {
  id: string;
  roundNumber: number;
  status: RoundStatus;
  createdAt: string;
  revealedAt: string | null;
}

/**
 * One person's card, once the round is revealed.
 *
 * There is no `hasVoted` variant of this type on purpose: before the reveal the wire carries
 * participant ids only (`votedParticipantIds`), so there is no shape a value could travel in.
 *
 * `originalValue`/`editedAt` are the evidence that somebody changed their card *after* the room
 * saw it (issue #11). They travel with the vote rather than as a separate list because the pair
 * is meaningless apart from the card it belongs to, and because every publisher of round state
 * already goes through one function (`toRoundStateDto`) — so no reveal payload can carry a new
 * value while quietly dropping the fact that it replaced an older one.
 */
export interface RevealedVoteDto {
  participantId: string;
  value: string;
  /** The card this seat showed at reveal time, or null when it has not been edited since. */
  originalValue: string | null;
  /** When the card was last changed after the reveal, or null. */
  editedAt: string | null;
}

/** Whether a revealed vote was changed after the room had already seen it. */
export function isEditedVote(vote: RevealedVoteDto): boolean {
  return vote.editedAt !== null;
}

/**
 * Everything a client needs to render the voting area, from whichever direction it arrives —
 * the socket snapshot on connect, or `GET /rooms/:code/round` for somebody without a seat.
 *
 * `votes` and `tally` are empty/null while the round is `voting`. That is not a rendering
 * convenience: the server never puts them in this object at all unless the round is revealed
 * (FR-4), so a client that ignored the status still could not show a value early.
 */
export interface RoundStateDto {
  round: RoundDto | null;
  /** Who has voted. Safe before the reveal — PRD §8's `vote:cast` payload is exactly this much. */
  votedParticipantIds: string[];
  /** Empty until the host reveals. */
  votes: RevealedVoteDto[];
  /** null until the host reveals. */
  tally: RoundTally | null;
}
