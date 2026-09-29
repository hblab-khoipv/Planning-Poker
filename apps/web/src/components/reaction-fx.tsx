'use client';

import { REACTION_TTL_MS } from '@planning-poker/shared';
import { type LiveReaction, reactionDrift } from '@/lib/reactions';

/**
 * The emoji in flight — the only visual part of a reaction.
 *
 * Both layers are `pointer-events-none` and absolutely positioned over what is already on the
 * screen, so a busy emoji fight can never cover a card, steal a click or shift the layout: the
 * table and the seats render exactly as they would with no reactions at all.
 *
 * The animation runs for `REACTION_TTL_MS`, the same window the list prunes by, so an emoji
 * disappears from the DOM at the moment it finishes fading rather than blinking out mid-flight.
 * `prefers-reduced-motion` swaps both animations for a plain fade in `globals.css` — the emoji
 * still appears and still goes away, it just does not fly.
 */

const DURATION = { animationDuration: `${REACTION_TTL_MS}ms` };

/** Thrown at the table: floats up over the middle of the room, drifting by its own id. */
export function TableReactions({ reactions }: { reactions: LiveReaction[] }) {
  return (
    <div
      data-testid="table-reactions"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          data-testid="reaction-emoji"
          data-emoji={reaction.emoji}
          className="animate-reaction-float absolute bottom-2 left-1/2 text-4xl drop-shadow-lg"
          style={{ ...DURATION, ['--reaction-drift' as string]: `${reactionDrift(reaction.id)}px` }}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}

/** Thrown at one person: flies in and lands on their seat. */
export function SeatReactions({ reactions }: { reactions: LiveReaction[] }) {
  return (
    <div
      data-testid="seat-reactions"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          data-testid="reaction-emoji"
          data-emoji={reaction.emoji}
          className="animate-reaction-land absolute left-1/2 top-0 text-4xl drop-shadow-lg"
          style={DURATION}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}
