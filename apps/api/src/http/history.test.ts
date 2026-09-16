import type { DeckType } from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import type { RoomHistoryEntry, RoundWithVotes } from '../db/repositories/history.js';
import type { Room, Vote, VotingRound } from '../db/repositories/index.js';
import { canViewRoomHistory, toRoomHistoryEntryDto, toRoundHistoryEntryDto } from './history.js';

/**
 * The two decisions session history makes on its own (PRD FR-9): who may read a room's past, and
 * how much of a round that past gives up. Both are pure functions of rows, so both are asserted
 * here rather than through the database.
 */

const ROOM: Room = {
  id: 'room-1',
  code: 'ABCD1234',
  name: 'Sprint 42 refinement',
  deckType: 'fibonacci',
  hostId: 'user-1',
  hostParticipantId: 'seat-1',
  createdAt: new Date('2026-09-01T09:00:00.000Z'),
  lastActiveAt: new Date('2026-09-01T10:30:00.000Z'),
};

function round(overrides: Partial<VotingRound> = {}): VotingRound {
  return {
    id: 'round-1',
    roomId: ROOM.id,
    roundNumber: 1,
    status: 'revealed',
    createdAt: new Date('2026-09-01T09:05:00.000Z'),
    revealedAt: new Date('2026-09-01T09:10:00.000Z'),
    ...overrides,
  };
}

function vote(participantId: string, value: string, edit?: { from: string; at: Date }): Vote {
  return {
    id: `vote-${participantId}`,
    roundId: 'round-1',
    participantId,
    value,
    votedAt: new Date('2026-09-01T09:07:00.000Z'),
    originalValue: edit?.from ?? null,
    editedAt: edit?.at ?? null,
  };
}

describe('toRoomHistoryEntryDto', () => {
  const entry: RoomHistoryEntry = {
    room: ROOM,
    participantCount: 5,
    roundCount: 3,
    revealedRoundCount: 2,
    lastRevealedAt: new Date('2026-09-01T10:00:00.000Z'),
  };

  it('carries the room plus the counts the list screen shows', () => {
    expect(toRoomHistoryEntryDto(entry)).toEqual({
      room: {
        id: ROOM.id,
        code: ROOM.code,
        name: ROOM.name,
        deckType: ROOM.deckType,
        hostId: ROOM.hostId,
        hostParticipantId: ROOM.hostParticipantId,
        createdAt: '2026-09-01T09:00:00.000Z',
      },
      participantCount: 5,
      roundCount: 3,
      revealedRoundCount: 2,
      lastRevealedAt: '2026-09-01T10:00:00.000Z',
      lastActiveAt: '2026-09-01T10:30:00.000Z',
    });
  });

  it('reports a room nobody ever revealed in rather than hiding it', () => {
    const dto = toRoomHistoryEntryDto({
      ...entry,
      roundCount: 2,
      revealedRoundCount: 0,
      lastRevealedAt: null,
    });

    expect(dto.lastRevealedAt).toBeNull();
    expect(dto.roundCount).toBe(2);
  });
});

describe('toRoundHistoryEntryDto', () => {
  it('returns the cards and the tally for a revealed round', () => {
    const entry: RoundWithVotes = {
      round: round(),
      votes: [vote('seat-1', '3'), vote('seat-2', '5')],
    };

    const dto = toRoundHistoryEntryDto(entry, 'fibonacci');

    expect(dto.round.roundNumber).toBe(1);
    expect(dto.round.revealedAt).toBe('2026-09-01T09:10:00.000Z');
    expect(dto.votes).toEqual([
      { participantId: 'seat-1', value: '3', originalValue: null, editedAt: null },
      { participantId: 'seat-2', value: '5', originalValue: null, editedAt: null },
    ]);
    expect(dto.tally).toMatchObject({ voteCount: 2, average: 4, median: 4, consensus: false });
  });

  it('still says which card was edited long after the meeting (issue #11)', () => {
    const entry: RoundWithVotes = {
      round: round(),
      votes: [
        vote('seat-1', '3', { from: '8', at: new Date('2026-09-01T09:12:00.000Z') }),
        vote('seat-2', '5'),
      ],
    };

    const dto = toRoundHistoryEntryDto(entry, 'fibonacci');

    expect(dto.votes[0]).toMatchObject({
      value: '3',
      originalValue: '8',
      editedAt: '2026-09-01T09:12:00.000Z',
    });
  });

  /**
   * The regression this whole file exists for. A room abandoned mid-round leaves a `voting` round
   * behind; asking for it as *history* must not be a way to read cards the room itself never saw.
   */
  it('withholds the cards of a round that was never revealed', () => {
    const entry: RoundWithVotes = {
      round: round({ id: 'round-2', roundNumber: 2, status: 'voting', revealedAt: null }),
      votes: [vote('seat-1', '8'), vote('seat-2', '13')],
    };

    const dto = toRoundHistoryEntryDto(entry, 'fibonacci');

    expect(dto.votes).toEqual([]);
    expect(dto.tally).toBeNull();
    // Who voted is still public — that is exactly what the live room shows before a reveal.
    expect(dto.votedParticipantIds).toEqual(['seat-1', 'seat-2']);
    expect(JSON.stringify(dto)).not.toContain('13');
  });

  it('leaves average and median out for a non-numeric deck', () => {
    const deckType: DeckType = 'tshirt';
    const dto = toRoundHistoryEntryDto(
      { round: round(), votes: [vote('seat-1', 'M'), vote('seat-2', 'M')] },
      deckType,
    );

    expect(dto.tally).toMatchObject({ average: null, median: null, consensus: true });
  });
});

describe('canViewRoomHistory', () => {
  it('lets a member of the room read it', () => {
    expect(canViewRoomHistory({ callerUserId: 'user-1', isMember: true })).toBe(true);
  });

  it('refuses a signed-in user who never took part', () => {
    expect(canViewRoomHistory({ callerUserId: 'user-2', isMember: false })).toBe(false);
  });

  /**
   * A guest cannot be a member, but the predicate is asserted with `isMember: true` anyway: the
   * point is that no membership evidence whatsoever lets an account-less caller through, because
   * the only thing a guest could present is a participant id from their own browser.
   */
  it('refuses a guest even when a seat matches', () => {
    expect(canViewRoomHistory({ callerUserId: null, isMember: true })).toBe(false);
    expect(canViewRoomHistory({ callerUserId: null, isMember: false })).toBe(false);
  });
});
