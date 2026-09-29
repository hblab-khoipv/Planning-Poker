import { REACTION_TTL_MS } from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import {
  applyReactionThrown,
  type LiveReaction,
  MAX_LIVE_REACTIONS,
  pruneReactions,
  reactionDrift,
  seatReactions,
  tableReactions,
} from './reactions';

function reaction(overrides: Partial<LiveReaction> = {}): LiveReaction {
  return {
    id: 'r1',
    emoji: '🎉',
    fromParticipantId: 'seat-lan',
    targetParticipantId: null,
    thrownAt: 1000,
    ...overrides,
  };
}

describe('applyReactionThrown', () => {
  it('appends a throw and ignores a repeat of the same one', () => {
    const one = applyReactionThrown([], reaction(), 1000);
    expect(one).toHaveLength(1);
    // The id is server-minted and unique per throw, so a redelivered event must not draw twice.
    expect(applyReactionThrown(one, reaction(), 1000)).toBe(one);
  });

  it('prunes expired throws as it appends', () => {
    const old = reaction({ id: 'old', thrownAt: 0 });
    const next = applyReactionThrown(
      [old],
      reaction({ id: 'new', thrownAt: REACTION_TTL_MS }),
      REACTION_TTL_MS,
    );
    expect(next.map((r) => r.id)).toEqual(['new']);
  });

  it('caps the list from the front, so the newest emoji always shows', () => {
    let list: readonly LiveReaction[] = [];
    for (let i = 0; i < MAX_LIVE_REACTIONS + 3; i += 1) {
      list = applyReactionThrown(list, reaction({ id: `r${i}` }), 1000);
    }
    expect(list).toHaveLength(MAX_LIVE_REACTIONS);
    expect(list[list.length - 1]?.id).toBe(`r${MAX_LIVE_REACTIONS + 2}`);
    expect(list[0]?.id).toBe('r3');
  });
});

describe('pruneReactions', () => {
  it('keeps what is still in flight and returns the same array when nothing expired', () => {
    const list = [reaction({ id: 'a', thrownAt: 1000 })];
    expect(pruneReactions(list, 1000 + REACTION_TTL_MS - 1)).toBe(list);
    expect(pruneReactions(list, 1000 + REACTION_TTL_MS)).toEqual([]);
  });
});

describe('splitting by destination', () => {
  it('separates the table from a targeted seat', () => {
    const list = [
      reaction({ id: 'a' }),
      reaction({ id: 'b', targetParticipantId: 'seat-khoi' }),
      reaction({ id: 'c', targetParticipantId: 'seat-lan' }),
    ];
    expect(tableReactions(list).map((r) => r.id)).toEqual(['a']);
    expect(seatReactions(list, 'seat-khoi').map((r) => r.id)).toEqual(['b']);
    expect(seatReactions(list, 'nobody')).toEqual([]);
  });
});

describe('reactionDrift', () => {
  it('is stable per id and spread across the table', () => {
    expect(reactionDrift('abc')).toBe(reactionDrift('abc'));

    const offsets = ['a', 'b', 'c', 'd', 'e', 'f'].map(reactionDrift);
    expect(new Set(offsets).size).toBeGreaterThan(1);
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(-40);
      expect(offset).toBeLessThanOrEqual(40);
    }
  });
});
