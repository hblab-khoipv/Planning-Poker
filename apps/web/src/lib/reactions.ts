import { REACTION_TTL_MS, type ReactionThrownPayload } from '@planning-poker/shared';

/**
 * The browser's side of thrown emoji: what is currently in flight, and where each one drifts to.
 *
 * Reactions are ephemeral (`apps/api/src/realtime/reactions.ts`), so this is the only place they
 * exist at all on the client — a bounded list that prunes itself. The rules live here rather than
 * in the component for the usual reason in this codebase: expiry, the cap and the drift all have
 * edge cases, and they are worth asserting directly instead of through a rendered tree.
 *
 * Nothing here touches a round, a vote or a participant list, which is what keeps a busy emoji
 * fight from disturbing voting.
 */

/** Never show more than this at once, however fast the room throws. */
export const MAX_LIVE_REACTIONS = 12;

export type LiveReaction = ReactionThrownPayload;

/** Drops everything whose time on screen is up. Returns the same array when nothing changed,
 * so React can skip a render in a quiet room. */
export function pruneReactions(
  current: readonly LiveReaction[],
  now: number,
): readonly LiveReaction[] {
  const kept = current.filter((reaction) => now - reaction.thrownAt < REACTION_TTL_MS);
  return kept.length === current.length ? current : kept;
}

/**
 * Applies one `reaction:thrown`.
 *
 * Two things it is careful about. The id is server-minted and unique per throw, so an event
 * delivered twice (a reconnect replaying, say) is ignored rather than drawn twice. And the list
 * is capped from the front: a room that throws faster than the animation can clear loses the
 * oldest emoji, never the newest, so the screen stays responsive instead of accumulating.
 */
export function applyReactionThrown(
  current: readonly LiveReaction[],
  thrown: LiveReaction,
  now: number,
): readonly LiveReaction[] {
  if (current.some((reaction) => reaction.id === thrown.id)) return current;

  const next = [...pruneReactions(current, now), thrown];
  return next.length > MAX_LIVE_REACTIONS ? next.slice(next.length - MAX_LIVE_REACTIONS) : next;
}

/** Thrown at the table: floats over the middle of the room. */
export function tableReactions(current: readonly LiveReaction[]): LiveReaction[] {
  return current.filter((reaction) => reaction.targetParticipantId === null);
}

/** Thrown at one person: lands on their seat instead of on the table. */
export function seatReactions(
  current: readonly LiveReaction[],
  participantId: string,
): LiveReaction[] {
  return current.filter((reaction) => reaction.targetParticipantId === participantId);
}

/**
 * Where a table-bound emoji drifts to, as a percentage offset from the centre.
 *
 * Derived from the id rather than drawn at random, so the same emoji drifts the same way on
 * every re-render — a random offset would make it jump sideways whenever React repainted — and
 * so two emoji thrown at once do not stack into one blob.
 */
export function reactionDrift(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1000;
  }
  return (hash % 81) - 40;
}
