'use client';

import { DECKS, type DeckType } from '@planning-poker/shared';

/**
 * The room's cards (PRD §9.4, FR-4).
 *
 * The deck rendered is the room's own — a Fibonacci room never shows an 'XL' — so the value the
 * server rejects is one the UI could not offer in the first place; the server still checks,
 * because the browser's opinion is not authoritative.
 *
 * The chosen card is marked with `aria-pressed` rather than colour alone: which card you picked
 * is the one piece of state a voter needs to be sure of before the reveal, and it has to survive
 * being read by a screen reader.
 */
export function VoteDeck({
  deckType,
  selected,
  disabled = false,
  editing = false,
  onSelect,
}: {
  deckType: DeckType;
  /** This browser's own card in the current round, restored after a reload. */
  selected: string | null;
  /** True once the round is revealed — the cards are on the table, nothing left to choose. */
  disabled?: boolean;
  /**
   * The round is revealed and this browser has asked to correct its own card (issue #11).
   * Only the label changes: picking a card here is a public edit, and saying so before the click
   * is what keeps it from feeling like an ordinary, private vote.
   */
  editing?: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <section aria-labelledby="deck-heading" className="space-y-3">
      <h2 id="deck-heading" className="text-xl font-semibold">
        {editing ? 'Chọn thẻ mới — cả phòng sẽ thấy bạn đã sửa' : 'Chọn thẻ của bạn'}
      </h2>

      <ul data-testid="vote-deck" className="flex flex-wrap gap-2">
        {DECKS[deckType].map((value) => {
          const isSelected = value === selected;
          return (
            <li key={value}>
              <button
                type="button"
                data-testid="vote-card"
                data-value={value}
                data-selected={isSelected ? 'true' : 'false'}
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => onSelect(value)}
                className={`h-20 w-14 rounded-lg border text-lg font-semibold transition ${
                  isSelected
                    ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200 ring-2 ring-indigo-400'
                    : 'border-slate-700 bg-slate-900 text-slate-100 hover:border-indigo-500'
                } ${editing ? 'ring-1 ring-amber-400/60' : ''} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {value}
              </button>
            </li>
          );
        })}
      </ul>

      {disabled ? (
        <p className="text-sm text-slate-400" data-testid="deck-locked">
          Round đã lật bài. Bấm “Sửa bài” trên lá bài của bạn nếu muốn đổi, hoặc chờ host mở round
          mới.
        </p>
      ) : null}

      {editing ? (
        <p className="text-sm text-amber-300" data-testid="deck-editing">
          Bạn đang sửa lá bài đã lật — thẻ mới sẽ được đánh dấu “đã sửa” cho cả phòng thấy.
        </p>
      ) : null}
    </section>
  );
}
