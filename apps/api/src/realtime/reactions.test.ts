import { REACTION_RATE_LIMIT, VOTE_ERROR_CODES } from '@planning-poker/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Participant, Room } from '../db/repositories/index.js';
import { handleReactionThrow, ReactionRateLimiter, readReactionRequest } from './reactions.js';
import { VoteActionError } from './voting.js';

/**
 * The two rules a thrown emoji has to obey before it reaches anybody's screen: it must be one of
 * the palette's, and it must not arrive faster than the room can stand. Both are asserted here
 * rather than through a socket, because both are decisions made before any I/O happens.
 */

const ROOM = { id: 'room-1', code: 'ABC123' } as unknown as Room;
const ME = { id: 'seat-me', roomId: 'room-1' } as unknown as Participant;
const TARGET = { id: 'seat-lan', roomId: 'room-1' } as unknown as Participant;

function expectRefusal(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(VoteActionError);
    expect((error as VoteActionError).code).toBe(code);
    return;
  }
  throw new Error(`expected a refusal with code ${code}`);
}

describe('readReactionRequest', () => {
  it('accepts a palette emoji thrown at the table', () => {
    expect(readReactionRequest({ emoji: '🎉' })).toEqual({
      emoji: '🎉',
      targetParticipantId: null,
    });
  });

  it('keeps the target when one is named, and normalises an empty one away', () => {
    expect(readReactionRequest({ emoji: '🍅', targetParticipantId: 'seat-lan' })).toEqual({
      emoji: '🍅',
      targetParticipantId: 'seat-lan',
    });
    expect(readReactionRequest({ emoji: '🍅', targetParticipantId: '' })).toEqual({
      emoji: '🍅',
      targetParticipantId: null,
    });
  });

  it('refuses anything outside the palette', () => {
    // The one that matters: without the palette check this event would relay arbitrary text —
    // or an unbounded string — to every screen in the room.
    for (const emoji of ['💀', 'hello', '<script>alert(1)</script>', '👍👍', '', 42, null]) {
      expectRefusal(() => readReactionRequest({ emoji }), VOTE_ERROR_CODES.INVALID_EMOJI);
    }
    expectRefusal(() => readReactionRequest({}), VOTE_ERROR_CODES.INVALID_EMOJI);
    expectRefusal(() => readReactionRequest(undefined), VOTE_ERROR_CODES.INVALID_EMOJI);
  });

  it('refuses a target that is not a string', () => {
    expectRefusal(
      () => readReactionRequest({ emoji: '👍', targetParticipantId: { id: 'x' } }),
      VOTE_ERROR_CODES.INVALID_TARGET,
    );
  });
});

describe('ReactionRateLimiter', () => {
  it('allows the budget and refuses the one after it', () => {
    const limiter = new ReactionRateLimiter({ maxPerWindow: 3, windowMs: 1000, now: () => 0 });

    expect([limiter.tryThrow('a'), limiter.tryThrow('a'), limiter.tryThrow('a')]).toEqual([
      true,
      true,
      true,
    ]);
    expect(limiter.tryThrow('a')).toBe(false);
  });

  it('slides: the budget frees up as the oldest throws age out, not all at once', () => {
    let now = 0;
    const limiter = new ReactionRateLimiter({ maxPerWindow: 2, windowMs: 1000, now: () => now });

    expect(limiter.tryThrow('a')).toBe(true);
    now = 600;
    expect(limiter.tryThrow('a')).toBe(true);
    expect(limiter.tryThrow('a')).toBe(false);

    // Only the first throw has aged out, so exactly one slot is back — a fixed window would
    // have handed back both and allowed a double burst across the boundary.
    now = 1001;
    expect(limiter.tryThrow('a')).toBe(true);
    expect(limiter.tryThrow('a')).toBe(false);
  });

  it('budgets per seat, and a refused throw does not extend the ban', () => {
    let now = 0;
    const limiter = new ReactionRateLimiter({ maxPerWindow: 1, windowMs: 1000, now: () => now });

    expect(limiter.tryThrow('a')).toBe(true);
    expect(limiter.tryThrow('b')).toBe(true);

    now = 500;
    expect(limiter.tryThrow('a')).toBe(false);
    // Holding the button down must not push the window forward: at 1001ms the original throw
    // has aged out and the seat is free again.
    now = 1001;
    expect(limiter.tryThrow('a')).toBe(true);
  });

  it('forgets a seat, and defaults to the shared limit', () => {
    const limiter = new ReactionRateLimiter({ windowMs: 60_000 });
    for (let i = 0; i < REACTION_RATE_LIMIT.maxPerWindow; i += 1) {
      expect(limiter.tryThrow('a')).toBe(true);
    }
    expect(limiter.tryThrow('a')).toBe(false);

    limiter.forget('a');
    expect(limiter.tryThrow('a')).toBe(true);
  });
});

describe('handleReactionThrow', () => {
  const io = null as never;

  function deps(overrides: Partial<Parameters<typeof handleReactionThrow>[3]> = {}) {
    return {
      lookup: vi.fn().mockResolvedValue(TARGET),
      limiter: new ReactionRateLimiter({ maxPerWindow: 10, windowMs: 1000 }),
      mintId: () => 'reaction-1',
      clock: () => 1_700_000_000_000,
      ...overrides,
    } as Parameters<typeof handleReactionThrow>[3];
  }

  it('refuses a target that is not a seat in this room', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    await expect(
      handleReactionThrow(
        io,
        { room: ROOM, participant: ME },
        { emoji: '🍅', targetParticipantId: 'seat-elsewhere' },
        deps({ lookup }),
      ),
    ).rejects.toMatchObject({ code: VOTE_ERROR_CODES.INVALID_TARGET });
    expect(lookup).toHaveBeenCalledWith(ROOM.id, 'seat-elsewhere');
  });

  it('does not look anything up for a throw at the table', async () => {
    const lookup = vi.fn();
    const emit = vi.fn();
    await handleReactionThrow(
      { to: () => ({ emit }) } as never,
      { room: ROOM, participant: ME },
      { emoji: '👍' },
      deps({ lookup }),
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('reaction:thrown', {
      id: 'reaction-1',
      emoji: '👍',
      fromParticipantId: ME.id,
      targetParticipantId: null,
      thrownAt: 1_700_000_000_000,
    });
  });

  it('refuses once the seat is over budget, before it touches the lookup', async () => {
    const lookup = vi.fn().mockResolvedValue(TARGET);
    const limiter = new ReactionRateLimiter({ maxPerWindow: 1, windowMs: 60_000 });
    const emit = vi.fn();
    const io = { to: () => ({ emit }) } as never;

    await handleReactionThrow(
      io,
      { room: ROOM, participant: ME },
      { emoji: '🔥' },
      deps({ limiter, lookup }),
    );
    await expect(
      handleReactionThrow(
        io,
        { room: ROOM, participant: ME },
        { emoji: '🔥', targetParticipantId: TARGET.id },
        deps({ limiter, lookup }),
      ),
    ).rejects.toMatchObject({ code: VOTE_ERROR_CODES.RATE_LIMITED });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });
});
