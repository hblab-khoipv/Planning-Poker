import type pg from 'pg';
import { config } from '../config.js';
import { type DeletedRoomSummary, deleteRoomsIdleBefore } from '../db/repositories/rooms.js';
import { ValidationError } from '../db/repositories/types.js';

/**
 * The idle-room sweep of PRD §3.1.9 / FR-10: a room nobody has touched for 24 hours is deleted,
 * and its participants, rounds and votes go with it.
 *
 * It runs in-process on an interval rather than as a cron entry, because the deployment target
 * is a single box running this same Node process (README → "Kiến trúc"): one unit to deploy and
 * to configure, no second scheduler to keep in sync with the app's env. The trade-off is that a
 * sweep only happens while the API is up — which is exactly when it matters, and a restart
 * catches up on the first tick either way, since staleness is read from the row, not from a
 * cursor this process keeps.
 *
 * What counts as activity is `rooms.last_active_at`, bumped by:
 *   - creating the room (`POST /rooms` — the column defaults to now()),
 *   - joining it (`POST /rooms/:code/join`),
 *   - a seat coming online over Socket.io (`realtime/index.ts`),
 *   - casting a vote, revealing a round, and starting a new one (`realtime/voting.ts`).
 * In other words: anything a person in the room does. Reads — `GET /rooms/:code`, the
 * participant list — deliberately do not count, so a bot or an open dashboard tab polling the
 * API cannot keep an abandoned room alive forever.
 */

/** Narrowed to what the job uses, so a test can capture the log lines instead of the console. */
export interface RoomCleanupLogger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface SweepIdleRoomsOptions {
  /** How long a room may sit untouched before it is swept. */
  idleHours?: number;
  /** Injected by the tests; production always sweeps against the wall clock. */
  now?: Date;
  logger?: RoomCleanupLogger;
}

export interface SweepResult {
  cutoff: Date;
  deleted: DeletedRoomSummary[];
  durationMs: number;
}

/**
 * The instant a room must have been active since in order to survive this sweep.
 *
 * Kept as a pure function so "is this room stale" is testable without a database or a timer,
 * and so the job logs the very cutoff it deletes by instead of a differently-rounded one.
 */
export function staleCutoff(now: Date, idleHours: number): Date {
  if (!Number.isFinite(idleHours) || idleHours <= 0) {
    throw new ValidationError('idleHours must be a positive number');
  }
  if (Number.isNaN(now.getTime())) {
    throw new ValidationError('now must be a valid date');
  }
  return new Date(now.getTime() - idleHours * 60 * 60 * 1000);
}

/**
 * Strictly older than the cutoff, matching the `<` the DELETE uses: a room touched exactly on
 * the boundary is kept. Ties go to the room — deletion is irreversible.
 */
export function isRoomStale(lastActiveAt: Date, cutoff: Date): boolean {
  return lastActiveAt.getTime() < cutoff.getTime();
}

/** Runs the sweep once. Exported so tests — and any future ops CLI — can trigger it directly. */
export async function sweepIdleRooms(
  db: pg.Pool,
  options: SweepIdleRoomsOptions = {},
): Promise<SweepResult> {
  const logger = options.logger ?? console;
  const idleHours = options.idleHours ?? config.roomIdleHours;
  const cutoff = staleCutoff(options.now ?? new Date(), idleHours);

  const startedAt = Date.now();
  const deleted = await deleteRoomsIdleBefore(db, cutoff);
  const durationMs = Date.now() - startedAt;

  // Silence on an empty sweep would make "the job is running" indistinguishable from "the job
  // is dead", so every run says something; only a run that actually deleted names the rooms.
  if (deleted.length === 0) {
    logger.info(
      `room-cleanup: no idle rooms (cutoff ${cutoff.toISOString()}, ${idleHours}h, ${durationMs}ms)`,
    );
  } else {
    logger.info(
      `room-cleanup: deleted ${deleted.length} idle room(s) ` +
        `(cutoff ${cutoff.toISOString()}, ${idleHours}h, ${durationMs}ms): ` +
        deleted.map((room) => `${room.code}@${room.lastActiveAt.toISOString()}`).join(', '),
    );
  }

  return { cutoff, deleted, durationMs };
}

export interface RoomCleanupTimers {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const NODE_TIMERS: RoomCleanupTimers = {
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface RoomCleanupJobOptions extends SweepIdleRoomsOptions {
  /** How often to sweep. Defaults to `ROOM_CLEANUP_INTERVAL_MS`. */
  intervalMs?: number;
  timers?: RoomCleanupTimers;
}

export interface RoomCleanupHandle {
  /** Stops the timer. The process exiting does the same, but tests need it explicit. */
  stop(): void;
}

/**
 * Starts the recurring sweep and hands back a handle that stops it.
 *
 * `unref()` where the runtime supports it: an interval an order of magnitude longer than any
 * request must not be the reason a shutting-down process stays alive.
 */
export function startRoomCleanupJob(
  db: pg.Pool,
  options: RoomCleanupJobOptions = {},
): RoomCleanupHandle {
  const timers = options.timers ?? NODE_TIMERS;
  const logger = options.logger ?? console;
  const intervalMs = options.intervalMs ?? config.roomCleanupIntervalMs;

  const run = (): void => {
    void sweepIdleRooms(db, options).catch((error: unknown) => {
      // One failed sweep must not kill the timer: the next tick retries, and the rooms it
      // would have deleted are still stale then.
      logger.error('room-cleanup: sweep failed', error);
    });
  };

  const handle = timers.setInterval(run, intervalMs);
  if (handle && typeof (handle as { unref?: () => void }).unref === 'function') {
    (handle as { unref: () => void }).unref();
  }

  logger.info(
    `room-cleanup: sweeping every ${intervalMs}ms for rooms idle over ` +
      `${options.idleHours ?? config.roomIdleHours}h`,
  );

  return { stop: () => timers.clearInterval(handle) };
}
