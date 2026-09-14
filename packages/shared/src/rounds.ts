/** Lifecycle of a voting round (PRD §7 `voting_rounds.status`, §8 `round:reset`). */
export const ROUND_STATUSES = ['voting', 'revealed'] as const;

export type RoundStatus = (typeof ROUND_STATUSES)[number];

export function isRoundStatus(value: unknown): value is RoundStatus {
  return typeof value === 'string' && (ROUND_STATUSES as readonly string[]).includes(value);
}
