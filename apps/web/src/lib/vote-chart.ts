import { DECKS, type DeckType, type RevealedVoteDto } from '@planning-poker/shared';

/**
 * The reveal summary as a distribution (issue #12).
 *
 * The complaint the issue records is that the old results list "hơi mất thời gian để xem xét":
 * to see whether the room agreed you had to read every row and hold the numbers in your head.
 * A distribution answers that in one glance — one bar per card that was actually played, tallest
 * bar wins — so the shape of the agreement is the picture rather than something you reconstruct.
 *
 * The arithmetic lives here, apart from the component, so the bars can be asserted as numbers.
 * A chart whose bars are wrong is a chart that lies, and that is not something a screenshot
 * review would catch.
 */

export interface VoteChartBar {
  /** The card face: '5', 'XL', '?'. */
  value: string;
  count: number;
  /** Share of the votes cast, 0–1 — what the bar's height is drawn from. */
  ratio: number;
  /** Who played this card, in room order, so the bar can name names on hover and to a reader. */
  voters: string[];
  /** True for the card (or cards) the most people played. */
  isMode: boolean;
}

/**
 * One bar per card somebody actually played, in the room's own deck order.
 *
 * Deck order rather than count order is deliberate: a planning deck is a scale, and a chart of a
 * scale that reorders itself by popularity makes "the room is split between 3 and 13" look the
 * same as "the room is split between 3 and 5". Cards nobody chose are left out rather than drawn
 * as gaps, because with ten Fibonacci cards a room of four would otherwise be mostly empty air.
 */
export function voteChartBars(
  deckType: DeckType,
  votes: readonly RevealedVoteDto[],
  namesByParticipantId: ReadonlyMap<string, string> = new Map(),
): VoteChartBar[] {
  const counts = new Map<string, string[]>();
  for (const vote of votes) {
    const voters = counts.get(vote.value) ?? [];
    voters.push(namesByParticipantId.get(vote.participantId) ?? vote.participantId);
    counts.set(vote.value, voters);
  }

  const deckOrder = DECKS[deckType];
  const played = [...counts.keys()].sort((a, b) => {
    const left = deckOrder.indexOf(a);
    const right = deckOrder.indexOf(b);
    // A card that is not in the deck at all (an old round of a room whose deck changed) sorts
    // last rather than first, which is where indexOf's -1 would otherwise put it.
    return (left === -1 ? deckOrder.length : left) - (right === -1 ? deckOrder.length : right);
  });

  const highest = Math.max(0, ...[...counts.values()].map((voters) => voters.length));

  return played.map((value) => {
    const voters = counts.get(value) ?? [];
    return {
      value,
      count: voters.length,
      // Against the tallest bar, not against the vote count: with 3 votes split 2–1 the winning
      // bar should reach the top of the chart, not two thirds of the way up.
      ratio: highest === 0 ? 0 : voters.length / highest,
      voters,
      isMode: voters.length === highest,
    };
  });
}

/** A screen-reader sentence for the chart, so the picture is not the only way to read it. */
export function describeChart(bars: readonly VoteChartBar[]): string {
  if (bars.length === 0) return 'Chưa có lượt vote nào.';
  return bars.map((bar) => `${bar.value}: ${bar.count} vote`).join(', ');
}
