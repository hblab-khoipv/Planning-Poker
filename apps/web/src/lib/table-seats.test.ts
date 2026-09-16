import type { ParticipantDto } from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import { arrangeSeats, seatCardState, type TableSeating } from './table-seats';

/**
 * Issue #11's table, as arithmetic.
 *
 * The two properties worth pinning are the ones a screenshot cannot prove: that the host really
 * is in the middle of the near edge for every room size, and that seating people never loses or
 * duplicates one.
 */

function person(id: string, overrides: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    id,
    displayName: id,
    isGuest: true,
    isHost: false,
    isOnline: true,
    joinedAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

function everybody(seating: TableSeating): string[] {
  return [...seating.top, ...seating.left, ...seating.right, ...seating.bottom].map(
    (participant) => participant.id,
  );
}

describe('arrangeSeats', () => {
  it('seats a room with nobody in it without inventing a seat', () => {
    expect(arrangeSeats([])).toEqual({ top: [], left: [], right: [], bottom: [] });
  });

  it('sits a lone host at the near edge', () => {
    const seating = arrangeSeats([person('host', { isHost: true })]);

    expect(seating.bottom.map((p) => p.id)).toEqual(['host']);
    expect(seating.top).toEqual([]);
  });

  it('puts the host in the middle of the near edge, between their neighbours', () => {
    // Seven others fill top (4) and both sides (2 + 2 would need nine), leaving one for bottom.
    const people = [
      person('host', { isHost: true }),
      ...Array.from({ length: 9 }, (_, index) => person(`p${index}`)),
    ];

    const seating = arrangeSeats(people);
    const bottom = seating.bottom.map((p) => p.id);

    expect(bottom).toContain('host');
    // One neighbour on each side: the host is the middle of a three-seat edge.
    expect(bottom.indexOf('host')).toBe(Math.floor(bottom.length / 2));
  });

  it('faces the room even when everybody else arrived first', () => {
    const people = [
      ...Array.from({ length: 4 }, (_, index) => person(`early${index}`)),
      person('host', { isHost: true }),
    ];

    expect(arrangeSeats(people).bottom.map((p) => p.id)).toEqual(['host']);
  });

  it('seats each person exactly once, at every room size', () => {
    for (const size of [1, 2, 3, 5, 8, 13, 21]) {
      const people = [
        person('host', { isHost: true }),
        ...Array.from({ length: size - 1 }, (_, index) => person(`p${index}`)),
      ];

      const seated = everybody(arrangeSeats(people));
      expect(seated).toHaveLength(size);
      expect(new Set(seated).size).toBe(size);
    }
  });

  it('still seats everybody in a room that has no host at all', () => {
    // `rooms.host_id` is nullable and a host's seat can be removed, so "no host" is a real state
    // rather than a hypothetical one.
    const seating = arrangeSeats([person('a'), person('b')]);

    expect(everybody(seating).sort()).toEqual(['a', 'b']);
    expect(seating.bottom).toEqual([]);
  });

  it('fills the far edge before the sides, so two people read as a table', () => {
    const seating = arrangeSeats([person('host', { isHost: true }), person('a'), person('b')]);

    expect(seating.top.map((p) => p.id)).toEqual(['a', 'b']);
    expect(seating.left).toEqual([]);
    expect(seating.right).toEqual([]);
  });
});

describe('seatCardState', () => {
  it('greys the card of somebody who has not chosen yet', () => {
    expect(seatCardState({ hasVoted: false, isRevealed: false, hasRevealedValue: false })).toBe(
      'waiting',
    );
  });

  it('colours the card of somebody who has chosen, without saying what', () => {
    expect(seatCardState({ hasVoted: true, isRevealed: false, hasRevealedValue: false })).toBe(
      'voted',
    );
  });

  it('turns a card face up only once the round is revealed', () => {
    expect(seatCardState({ hasVoted: true, isRevealed: true, hasRevealedValue: true })).toBe(
      'revealed',
    );
  });

  it('marks a seat that never played a card, rather than showing it as still thinking', () => {
    expect(seatCardState({ hasVoted: false, isRevealed: true, hasRevealedValue: false })).toBe(
      'no-vote',
    );
  });

  it('never reports a face-up card while the round is open, whatever it is told', () => {
    // The guarantee behind FR-4 on this screen: no combination of inputs produces 'revealed'
    // for a round the server has not revealed.
    for (const hasVoted of [true, false]) {
      for (const hasRevealedValue of [true, false]) {
        expect(seatCardState({ hasVoted, isRevealed: false, hasRevealedValue })).not.toBe(
          'revealed',
        );
      }
    }
  });
});
