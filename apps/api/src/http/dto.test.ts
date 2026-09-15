import { describe, expect, it } from 'vitest';
import type { Participant, Room } from '../db/repositories/index.js';
import {
  FALLBACK_DISPLAY_NAME,
  participantDisplayName,
  toParticipantDto,
  toRoomDto,
  toRoundStateDto,
} from './dto.js';

const HOST_USER_ID = '11111111-1111-4111-8111-111111111111';

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    roomId: '33333333-3333-4333-8333-333333333333',
    userId: null,
    guestName: 'Khôi',
    joinedAt: new Date('2026-09-14T10:00:00.000Z'),
    isOnline: true,
    ...overrides,
  };
}

describe('participantDisplayName', () => {
  it('prefers the per-room name, which is how a signed-in member renames themselves', () => {
    expect(participantDisplayName('Khôi (QA)', 'Phạm Văn Khôi')).toBe('Khôi (QA)');
  });

  it('falls back to the account name when no per-room name was given', () => {
    expect(participantDisplayName(null, 'Phạm Văn Khôi')).toBe('Phạm Văn Khôi');
  });

  it('never returns an empty label', () => {
    expect(participantDisplayName(null, null)).toBe(FALLBACK_DISPLAY_NAME);
  });
});

describe('toParticipantDto', () => {
  it('marks a seat with no user id as a guest and never as host', () => {
    const dto = toParticipantDto(participant(), { hostId: HOST_USER_ID });

    expect(dto).toMatchObject({ displayName: 'Khôi', isGuest: true, isHost: false });
    expect(dto.joinedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('marks the room host', () => {
    const dto = toParticipantDto(participant({ userId: HOST_USER_ID, guestName: null }), {
      userName: 'Host',
      hostId: HOST_USER_ID,
    });

    expect(dto).toMatchObject({ displayName: 'Host', isGuest: false, isHost: true });
  });

  it('does not call a guest-hosted room’s guests hosts, even though both host ids are null', () => {
    const dto = toParticipantDto(participant(), { hostId: null });

    expect(dto.isHost).toBe(false);
  });

  it('reads the account name off a row that already joined users', () => {
    const dto = toParticipantDto(
      { ...participant({ userId: HOST_USER_ID, guestName: null }), userName: 'Joined name' },
      { hostId: null },
    );

    expect(dto.displayName).toBe('Joined name');
  });
});

describe('toRoomDto', () => {
  it('serialises dates as ISO strings and keeps the join code', () => {
    const room: Room = {
      id: '44444444-4444-4444-8444-444444444444',
      code: 'AB12CD34',
      name: 'Sprint 42',
      deckType: 'fibonacci',
      hostId: null,
      hostParticipantId: null,
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
      lastActiveAt: new Date('2026-09-14T11:00:00.000Z'),
    };

    expect(toRoomDto(room)).toEqual({
      id: room.id,
      code: 'AB12CD34',
      name: 'Sprint 42',
      deckType: 'fibonacci',
      hostId: null,
      hostParticipantId: null,
      createdAt: '2026-09-14T10:00:00.000Z',
    });
  });
});

/**
 * The FR-4 choke point. Every publisher of round state — the socket snapshot, the reveal
 * broadcast, `GET /rooms/:code/round` — goes through `toRoundStateDto`, so these assertions are
 * what stops a card value reaching a client early no matter which path it takes.
 */
describe('toRoundStateDto', () => {
  const VOTES = [
    {
      id: 'v1',
      roundId: 'r1',
      participantId: 'p1',
      value: '5',
      votedAt: new Date('2026-09-15T00:00:01.000Z'),
    },
    {
      id: 'v2',
      roundId: 'r1',
      participantId: 'p2',
      value: '5',
      votedAt: new Date('2026-09-15T00:00:02.000Z'),
    },
  ];

  const OPEN_ROUND = {
    id: 'r1',
    roomId: 'room1',
    roundNumber: 2,
    status: 'voting' as const,
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    revealedAt: null,
  };

  const REVEALED_ROUND = {
    ...OPEN_ROUND,
    status: 'revealed' as const,
    revealedAt: new Date('2026-09-15T00:00:10.000Z'),
  };

  it('publishes who voted but never what, while the round is open', () => {
    const state = toRoundStateDto(OPEN_ROUND, VOTES, 'fibonacci');

    expect(state.votedParticipantIds).toEqual(['p1', 'p2']);
    expect(state.votes).toEqual([]);
    expect(state.tally).toBeNull();
    // The strongest form of the assertion: no card face anywhere in the serialised payload.
    expect(JSON.stringify(state)).not.toContain('"5"');
  });

  it('publishes the values and the tally once the round is revealed', () => {
    const state = toRoundStateDto(REVEALED_ROUND, VOTES, 'fibonacci');

    expect(state.round).toMatchObject({ status: 'revealed', roundNumber: 2 });
    expect(state.votes).toEqual([
      { participantId: 'p1', value: '5' },
      { participantId: 'p2', value: '5' },
    ]);
    expect(state.tally).toEqual({
      voteCount: 2,
      numericCount: 2,
      average: 5,
      median: 5,
      consensus: true,
    });
  });

  it('gives a t-shirt room consensus without inventing an average', () => {
    const state = toRoundStateDto(
      REVEALED_ROUND,
      VOTES.map((vote) => ({ ...vote, value: 'M' })),
      'tshirt',
    );

    expect(state.tally).toMatchObject({ average: null, median: null, consensus: true });
  });

  it('describes a room with no round yet without throwing', () => {
    expect(toRoundStateDto(null, [], 'fibonacci')).toEqual({
      round: null,
      votedParticipantIds: [],
      votes: [],
      tally: null,
    });
  });
});
