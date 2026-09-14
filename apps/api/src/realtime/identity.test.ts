import { SOCKET_ERROR_CODES } from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import type { Participant, Room } from '../db/repositories/types.js';
import {
  type ParticipantLookup,
  readHandshakeAuth,
  resolveSocketParticipant,
  SocketAuthError,
} from './identity.js';

/**
 * The rule under test: a socket can only ever pick up a seat REST already created. Everything
 * here is about what the server refuses — a connection that resolved to no seat, or to somebody
 * else's, would be handed a live feed of a room it has no business in.
 */

const ROOM: Room = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'ABCD2345',
  name: 'Sprint 42 refinement',
  deckType: 'fibonacci',
  hostId: null,
  createdAt: new Date('2026-09-15T00:00:00.000Z'),
  lastActiveAt: new Date('2026-09-15T00:00:00.000Z'),
};

function seat(overrides: Partial<Participant> = {}): Participant {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    roomId: ROOM.id,
    userId: null,
    guestName: 'Lan',
    joinedAt: new Date('2026-09-15T00:00:00.000Z'),
    isOnline: false,
    ...overrides,
  };
}

/** A lookup with nothing in it; each test fills in only the read it cares about. */
function lookupOf(overrides: Partial<ParticipantLookup> = {}): ParticipantLookup {
  return {
    findRoom: async () => ROOM,
    findSeatForUser: async () => null,
    findSeatById: async () => null,
    ...overrides,
  };
}

describe('readHandshakeAuth', () => {
  it('normalises the room code the same way the REST layer does', () => {
    expect(readHandshakeAuth({ roomCode: ' abcd2345 ' })).toEqual({
      roomCode: 'ABCD2345',
      participantId: null,
    });
  });

  it('keeps a participant id as a claim to be checked, not as an identity', () => {
    expect(readHandshakeAuth({ roomCode: 'ABCD2345', participantId: 'anything-at-all' })).toEqual({
      roomCode: 'ABCD2345',
      participantId: 'anything-at-all',
    });
  });

  it.each([undefined, null, {}, { roomCode: 42 }, { roomCode: 'TOO-SHORT' }])(
    'refuses a handshake without a usable room code: %j',
    (auth) => {
      expect(() => readHandshakeAuth(auth)).toThrow(SocketAuthError);
      expect(() => readHandshakeAuth(auth)).toThrow(
        expect.objectContaining({ code: SOCKET_ERROR_CODES.INVALID_HANDSHAKE }),
      );
    },
  );

  it('treats an empty participant id as absent rather than as a claim', () => {
    expect(readHandshakeAuth({ roomCode: 'ABCD2345', participantId: '' }).participantId).toBeNull();
  });
});

describe('resolveSocketParticipant', () => {
  it('matches a signed-in caller on their user id', async () => {
    const mine = seat({ userId: '33333333-3333-4333-8333-333333333333', guestName: null });
    const resolved = await resolveSocketParticipant(
      lookupOf({ findSeatForUser: async () => mine }),
      { claim: { roomCode: ROOM.code, participantId: null }, userId: mine.userId },
    );

    expect(resolved).toEqual({ room: ROOM, participant: mine });
  });

  it('ignores a participant id claimed by a signed-in caller, matching only on user id', async () => {
    const someoneElse = seat();
    let byIdWasConsulted = false;

    await expect(
      resolveSocketParticipant(
        lookupOf({
          findSeatById: async () => {
            byIdWasConsulted = true;
            return someoneElse;
          },
        }),
        {
          claim: { roomCode: ROOM.code, participantId: someoneElse.id },
          userId: '33333333-3333-4333-8333-333333333333',
        },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: SOCKET_ERROR_CODES.NOT_A_PARTICIPANT }));

    expect(byIdWasConsulted).toBe(false);
  });

  it('matches a guest on the seat id their browser stored for this room', async () => {
    const guest = seat();
    const resolved = await resolveSocketParticipant(lookupOf({ findSeatById: async () => guest }), {
      claim: { roomCode: ROOM.code, participantId: guest.id },
      userId: null,
    });

    expect(resolved.participant).toEqual(guest);
  });

  it('refuses a guest presenting a signed-in member’s seat id', async () => {
    const memberSeat = seat({ userId: '33333333-3333-4333-8333-333333333333' });

    await expect(
      resolveSocketParticipant(lookupOf({ findSeatById: async () => memberSeat }), {
        claim: { roomCode: ROOM.code, participantId: memberSeat.id },
        userId: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: SOCKET_ERROR_CODES.NOT_A_PARTICIPANT }));
  });

  it('refuses a guest with no seat id at all', async () => {
    await expect(
      resolveSocketParticipant(lookupOf(), {
        claim: { roomCode: ROOM.code, participantId: null },
        userId: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: SOCKET_ERROR_CODES.NOT_A_PARTICIPANT }));
  });

  it('refuses a seat id that belongs to no row in this room', async () => {
    await expect(
      resolveSocketParticipant(lookupOf({ findSeatById: async () => null }), {
        claim: { roomCode: ROOM.code, participantId: seat().id },
        userId: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: SOCKET_ERROR_CODES.NOT_A_PARTICIPANT }));
  });

  it('tells an unknown room apart from an unknown seat', async () => {
    await expect(
      resolveSocketParticipant(lookupOf({ findRoom: async () => null }), {
        claim: { roomCode: 'ZZ99ZZ99', participantId: null },
        userId: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: SOCKET_ERROR_CODES.ROOM_NOT_FOUND }));
  });
});
