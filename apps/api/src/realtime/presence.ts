/**
 * Who is currently in a room, counted in connections rather than in events.
 *
 * Two things make this less trivial than "connect = joined, disconnect = left":
 *
 * 1. One person can hold several sockets at once — a second tab, or the old socket lingering
 *    for a moment after a reload while the new one is already up. Counting sockets per seat
 *    means `participant:joined` fires when the *first* one arrives and `participant:left` is
 *    only ever considered when the *last* one goes.
 * 2. A network drop is indistinguishable from leaving, at the moment it happens. PRD §12 flags
 *    this as an open question; the answer here is a grace window — the seat stays online for
 *    `graceMs` after its last socket dies, and a reconnection inside that window cancels the
 *    departure entirely, so nobody is flushed out of a room by a lift or a page reload.
 *
 * Timers are injected so the unit tests can drive them, and so the integration suite can run
 * with a grace window measured in milliseconds instead of seconds.
 */

export interface PresenceTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const NODE_TIMERS: PresenceTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface PresenceTrackerOptions {
  graceMs: number;
  timers?: PresenceTimers;
}

export class PresenceTracker {
  private readonly sockets = new Map<string, Set<string>>();
  private readonly pendingLeaves = new Map<string, unknown>();
  private readonly timers: PresenceTimers;

  constructor(private readonly options: PresenceTrackerOptions) {
    this.timers = options.timers ?? NODE_TIMERS;
  }

  /**
   * Records a socket for a seat. Returns true when this is the seat's first live connection —
   * i.e. when the room should be told somebody joined. A reconnection inside the grace window
   * cancels the pending departure and returns false: from the room's point of view that person
   * never left, so announcing them again would be a lie.
   */
  attach(participantId: string, socketId: string): boolean {
    const hadPendingLeave = this.cancelPendingLeave(participantId);

    const existing = this.sockets.get(participantId);
    if (existing) {
      existing.add(socketId);
      return false;
    }

    this.sockets.set(participantId, new Set([socketId]));
    return !hadPendingLeave;
  }

  /**
   * Drops a socket. When it was the seat's last one, `onLeave` is scheduled `graceMs` later and
   * runs only if nothing reconnected in the meantime. Returns true when that timer was armed.
   */
  detach(participantId: string, socketId: string, onLeave: () => void): boolean {
    const existing = this.sockets.get(participantId);
    if (!existing) return false;

    existing.delete(socketId);
    if (existing.size > 0) return false;

    this.sockets.delete(participantId);
    this.pendingLeaves.set(
      participantId,
      this.timers.setTimeout(() => {
        this.pendingLeaves.delete(participantId);
        onLeave();
      }, this.options.graceMs),
    );
    return true;
  }

  isOnline(participantId: string): boolean {
    return this.sockets.has(participantId) || this.pendingLeaves.has(participantId);
  }

  connectionCount(participantId: string): number {
    return this.sockets.get(participantId)?.size ?? 0;
  }

  private cancelPendingLeave(participantId: string): boolean {
    const pending = this.pendingLeaves.get(participantId);
    if (pending === undefined) return false;

    this.timers.clearTimeout(pending);
    this.pendingLeaves.delete(participantId);
    return true;
  }

  /** Drops every armed timer without running it — for shutting a test server down cleanly. */
  dispose(): void {
    for (const handle of this.pendingLeaves.values()) this.timers.clearTimeout(handle);
    this.pendingLeaves.clear();
    this.sockets.clear();
  }
}
