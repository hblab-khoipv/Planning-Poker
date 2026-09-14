/** Card decks available when creating a room (PRD §3.1.1). */
export const DECK_TYPES = ['fibonacci', 'tshirt'] as const;

export type DeckType = (typeof DECK_TYPES)[number];

/** Non-numeric cards that must never take part in average/median maths. */
export const SPECIAL_CARDS = ['?', '☕'] as const;

export const DECKS: Record<DeckType, readonly string[]> = {
  fibonacci: ['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕'],
  tshirt: ['XS', 'S', 'M', 'L', 'XL', '?'],
};

/** Only numeric decks get average/median in the reveal summary (PRD FR-6). */
export const NUMERIC_DECKS: readonly DeckType[] = ['fibonacci'];

export function isDeckType(value: unknown): value is DeckType {
  return typeof value === 'string' && (DECK_TYPES as readonly string[]).includes(value);
}
