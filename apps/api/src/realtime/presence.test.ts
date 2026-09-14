import { describe, expect, it } from 'vitest';
import { PresenceTracker, type PresenceTimers } from './presence.js';

/**
 * Presence is the part of the realtime layer that has to be wrong on purpose: a disconnect is
 * only *probably* a departure. These tests pin both halves of that — a second tab must not
 * announce a second arrival, and a reconnect inside the grace window must not announce anything
 * at all.
 */

/** A hand-driven clock: nothing fires until `runAll()` says so. */
function fakeTimers() {
  const scheduled = new Map<number, () => void>();
  let nextHandle = 1;

  const timers: PresenceTimers = {
    setTimeout(handler) {
      const handle = nextHandle++;
      scheduled.set(handle, handler);
      return handle;
    },
    clearTimeout(handle) {
      scheduled.delete(handle as number);
    },
  };

  return {
    timers,
    pending: () => scheduled.size,
    runAll() {
      const due = [...scheduled.values()];
      scheduled.clear();
      for (const handler of due) handler();
    },
  };
}

function trackerWith(clock: ReturnType<typeof fakeTimers>) {
  return new PresenceTracker({ graceMs: 5000, timers: clock.timers });
}

describe('PresenceTracker', () => {
  it('announces the first connection for a seat', () => {
    const tracker = trackerWith(fakeTimers());
    expect(tracker.attach('p1', 'socket-a')).toBe(true);
  });

  it('does not announce a second tab as a second arrival', () => {
    const tracker = trackerWith(fakeTimers());
    tracker.attach('p1', 'socket-a');

    expect(tracker.attach('p1', 'socket-b')).toBe(false);
    expect(tracker.connectionCount('p1')).toBe(2);
  });

  it('keeps a seat online while any of its sockets survives', () => {
    const clock = fakeTimers();
    const tracker = trackerWith(clock);
    tracker.attach('p1', 'socket-a');
    tracker.attach('p1', 'socket-b');

    let left = false;
    expect(tracker.detach('p1', 'socket-a', () => (left = true))).toBe(false);

    clock.runAll();
    expect(left).toBe(false);
    expect(tracker.isOnline('p1')).toBe(true);
  });

  it('announces the departure once the last socket has gone and the grace window passes', () => {
    const clock = fakeTimers();
    const tracker = trackerWith(clock);
    tracker.attach('p1', 'socket-a');

    let left = false;
    expect(tracker.detach('p1', 'socket-a', () => (left = true))).toBe(true);

    // Still online *during* the window: this is exactly the reconnect grace PRD §12 asks about.
    expect(left).toBe(false);
    expect(tracker.isOnline('p1')).toBe(true);

    clock.runAll();
    expect(left).toBe(true);
    expect(tracker.isOnline('p1')).toBe(false);
  });

  it('cancels the departure when the same seat reconnects inside the window', () => {
    const clock = fakeTimers();
    const tracker = trackerWith(clock);
    tracker.attach('p1', 'socket-a');

    let left = false;
    tracker.detach('p1', 'socket-a', () => (left = true));

    // A reload: the new socket arrives before the timer fires. Nobody left, so nothing is
    // announced — re-announcing a join would make the other clients flash the seat out and in.
    expect(tracker.attach('p1', 'socket-b')).toBe(false);
    expect(clock.pending()).toBe(0);

    clock.runAll();
    expect(left).toBe(false);
    expect(tracker.isOnline('p1')).toBe(true);
  });

  it('announces a genuine rejoin after the window has already closed', () => {
    const clock = fakeTimers();
    const tracker = trackerWith(clock);
    tracker.attach('p1', 'socket-a');
    tracker.detach('p1', 'socket-a', () => undefined);
    clock.runAll();

    expect(tracker.attach('p1', 'socket-b')).toBe(true);
  });

  it('tracks seats independently', () => {
    const clock = fakeTimers();
    const tracker = trackerWith(clock);
    tracker.attach('p1', 'socket-a');

    expect(tracker.attach('p2', 'socket-b')).toBe(true);

    const gone: string[] = [];
    tracker.detach('p1', 'socket-a', () => gone.push('p1'));
    clock.runAll();

    expect(gone).toEqual(['p1']);
    expect(tracker.isOnline('p2')).toBe(true);
  });

  it('ignores a disconnect for a socket it never saw', () => {
    const clock = fakeTimers();
    const tracker = trackerWith(clock);

    let left = false;
    expect(tracker.detach('ghost', 'socket-a', () => (left = true))).toBe(false);

    clock.runAll();
    expect(left).toBe(false);
  });

  it('drops armed timers on dispose without running them', () => {
    const clock = fakeTimers();
    const tracker = trackerWith(clock);
    tracker.attach('p1', 'socket-a');

    let left = false;
    tracker.detach('p1', 'socket-a', () => (left = true));
    tracker.dispose();

    clock.runAll();
    expect(left).toBe(false);
    expect(tracker.isOnline('p1')).toBe(false);
  });
});
