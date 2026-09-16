import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../db/repositories/types.js';
import {
  isRoomStale,
  type RoomCleanupLogger,
  type RoomCleanupTimers,
  staleCutoff,
  startRoomCleanupJob,
  sweepIdleRooms,
} from './room-cleanup.js';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

/** Captures what the job logged, which is the whole point of the observability requirement. */
function recordingLogger(): RoomCleanupLogger & { infos: string[]; errors: unknown[][] } {
  const infos: string[] = [];
  const errors: unknown[][] = [];
  return {
    infos,
    errors,
    info: (message: string) => infos.push(message),
    error: (...args: unknown[]) => errors.push(args),
  };
}

/** A pool stand-in: the sweep only ever issues the one DELETE. */
function fakePool(result: { rows: unknown[] } | Error): pg.Pool & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    query: async (text: string, values: unknown[]) => {
      calls.push([text, values]);
      if (result instanceof Error) throw result;
      return { rows: result.rows, rowCount: result.rows.length };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('staleCutoff', () => {
  it('puts the cutoff exactly idleHours before now', () => {
    expect(staleCutoff(NOW, 24)).toEqual(hoursAgo(24));
  });

  it('accepts a sub-hour window, so a staging box can reclaim rooms fast', () => {
    expect(staleCutoff(NOW, 0.5)).toEqual(new Date(NOW.getTime() - 30 * 60 * 1000));
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the window %p', (hours) => {
    expect(() => staleCutoff(NOW, hours)).toThrow(ValidationError);
  });

  it('rejects an invalid clock rather than deleting against NaN', () => {
    expect(() => staleCutoff(new Date(Number.NaN), 24)).toThrow(ValidationError);
  });
});

describe('isRoomStale', () => {
  const cutoff = staleCutoff(NOW, 24);

  it('is stale a minute past the window', () => {
    expect(isRoomStale(hoursAgo(24.1), cutoff)).toBe(true);
  });

  it('is not stale a minute inside the window', () => {
    expect(isRoomStale(hoursAgo(23.9), cutoff)).toBe(false);
  });

  it('keeps a room sitting exactly on the boundary — ties go to the room', () => {
    expect(isRoomStale(cutoff, cutoff)).toBe(false);
  });

  it('keeps a room active right now', () => {
    expect(isRoomStale(NOW, cutoff)).toBe(false);
  });
});

describe('sweepIdleRooms', () => {
  it('deletes by the cutoff its own threshold rule produced', async () => {
    const pool = fakePool({ rows: [] });

    const result = await sweepIdleRooms(pool, {
      idleHours: 24,
      now: NOW,
      logger: recordingLogger(),
    });

    expect(result.cutoff).toEqual(hoursAgo(24));
    expect(pool.calls[0]?.[1]).toEqual([hoursAgo(24)]);
    expect(result.deleted).toEqual([]);
  });

  it('names the rooms it deleted, with their last activity', async () => {
    const lastActiveAt = hoursAgo(30);
    const pool = fakePool({
      rows: [{ id: 'room-1', code: 'AB12CD34', last_active_at: lastActiveAt }],
    });
    const logger = recordingLogger();

    const result = await sweepIdleRooms(pool, { idleHours: 24, now: NOW, logger });

    expect(result.deleted).toEqual([{ id: 'room-1', code: 'AB12CD34', lastActiveAt }]);
    expect(logger.infos.join('\n')).toContain('deleted 1 idle room(s)');
    expect(logger.infos.join('\n')).toContain('AB12CD34');
  });

  it('still logs a run that deleted nothing, so silence means "job is dead"', async () => {
    const logger = recordingLogger();

    await sweepIdleRooms(fakePool({ rows: [] }), { idleHours: 24, now: NOW, logger });

    expect(logger.infos.join('\n')).toContain('no idle rooms');
  });

  it('propagates a database failure to the caller', async () => {
    await expect(
      sweepIdleRooms(fakePool(new Error('connection refused')), {
        idleHours: 24,
        now: NOW,
        logger: recordingLogger(),
      }),
    ).rejects.toThrow('connection refused');
  });
});

describe('startRoomCleanupJob', () => {
  function fakeTimers(): RoomCleanupTimers & { handler?: () => void; cleared: boolean } {
    const state = {
      handler: undefined as (() => void) | undefined,
      cleared: false,
      intervalMs: 0,
      setInterval(handler: () => void, ms: number) {
        state.handler = handler;
        state.intervalMs = ms;
        return 'handle';
      },
      clearInterval() {
        state.cleared = true;
      },
    };
    return state;
  }

  it('sweeps on every tick and never on its own', async () => {
    const timers = fakeTimers();
    const pool = fakePool({ rows: [] });

    const job = startRoomCleanupJob(pool, {
      intervalMs: 300_000,
      idleHours: 24,
      now: NOW,
      timers,
      logger: recordingLogger(),
    });

    expect(pool.calls).toHaveLength(0);
    timers.handler?.();
    await vi.waitFor(() => expect(pool.calls).toHaveLength(1));

    job.stop();
    expect(timers.cleared).toBe(true);
  });

  it('logs a failed sweep and keeps the timer armed', async () => {
    const timers = fakeTimers();
    const logger = recordingLogger();

    startRoomCleanupJob(fakePool(new Error('nope')), {
      intervalMs: 300_000,
      idleHours: 24,
      timers,
      logger,
    });

    timers.handler?.();
    await vi.waitFor(() => expect(logger.errors).toHaveLength(1));
    expect(timers.cleared).toBe(false);
  });
});
