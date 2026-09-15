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
 */
export interface RevealedVoteDto {
  participantId: string;
  value: string;
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
