import { NUMERIC_DECKS, type DeckType } from './decks.js';

/**
 * The reveal summary (PRD FR-6): "bảng vote theo tên, tính trung bình/median (deck số), đánh dấu
 * đồng thuận khi tất cả giống nhau".
 *
 * This lives in the shared package because both ends need the same answer: the API computes it
 * once and broadcasts it with `round:revealed`, and the browser has to be able to recompute or
 * verify the same numbers from the same votes without a second round trip. Two implementations
 * of "what is the median of 1, 2, 3, 5" is exactly the drift `packages/shared` exists to stop.
 *
 * Nothing here is reachable before a reveal — the handler that builds this only runs once the
 * round's status is `revealed` (see `apps/api/src/realtime/voting.ts`).
 */

/**
 * A card that counts towards the maths. '?' and '☕' are deliberate abstentions rather than
 * estimates, so they are excluded from average and median even in a numeric deck — averaging
 * "I don't know" with "8" would invent a number nobody voted for.
 */
export function isNumericCard(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value.trim());
}

/** The numeric cards of a set of votes, in the order they were given. */
export function numericCardValues(values: readonly string[]): number[] {
  return values.filter(isNumericCard).map((value) => Number(value));
}

/** Two decimal places: enough for a story-point average, and free of float noise in assertions. */
export function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export function averageOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return roundToTwo(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** The middle value, or the mean of the two middle ones for an even count. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return roundToTwo(sorted[middle] as number);
  return roundToTwo(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2);
}

/**
 * True when everybody who voted voted the same card — the "đồng thuận" badge, which works for
 * either deck because it compares the card faces rather than any number behind them.
 *
 * A single vote is not consensus: one person agreeing with themselves is the trivial case, and
 * badging it would tell a half-empty room it had reached agreement. Two identical votes is the
 * smallest set where the word means anything.
 */
export function hasConsensus(values: readonly string[]): boolean {
  if (values.length < 2) return false;
  return values.every((value) => value === values[0]);
}

/** Whether a deck's cards carry numbers at all (PRD FR-6's "deck số"). */
export function isNumericDeck(deckType: DeckType): boolean {
  return NUMERIC_DECKS.includes(deckType);
}

/** What `round:revealed` carries alongside the votes themselves. */
export interface RoundTally {
  /** How many votes were cast in the round. */
  voteCount: number;
  /** How many of those took part in the maths (numeric deck, numeric card). */
  numericCount: number;
  /** null for a non-numeric deck, and for a round where nobody voted a number. */
  average: number | null;
  median: number | null;
  /** Every voter chose the same card. Independent of the deck being numeric. */
  consensus: boolean;
}

/**
 * The whole FR-6 summary for one round's votes.
 *
 * `values` must be the revealed votes of a single round. A t-shirt deck gets no average or
 * median even though 'XS'…'XL' have an obvious order: PRD FR-6 scopes those to numeric decks,
 * and a mean of sizes is not a story-point estimate.
 */
export function tallyVotes(deckType: DeckType, values: readonly string[]): RoundTally {
  const numeric = isNumericDeck(deckType) ? numericCardValues(values) : [];

  return {
    voteCount: values.length,
    numericCount: numeric.length,
    average: averageOf(numeric),
    median: medianOf(numeric),
    consensus: hasConsensus(values),
  };
}
