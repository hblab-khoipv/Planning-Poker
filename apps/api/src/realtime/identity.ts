import {
  parseRoomCode,
  SOCKET_ERROR_CODES,
  type SocketErrorCode,
  type SocketHandshakeAuth,
} from '@planning-poker/shared';
import type pg from 'pg';
import {
  findParticipantByUserInRoom,
  findParticipantInRoom,
} from '../db/repositories/participants.js';
import { findRoomByCode } from '../db/repositories/rooms.js';
import type { Participant, Queryable, Room } from '../db/repositories/types.js';
import { resolveCallerFromCookieHeader } from '../http/session.js';

/**
 * Who is on the other end of a socket, and which room they are allowed into.
 *
 * A socket never establishes an identity of its own: it can only pick up one that
 * `POST /rooms/:code/join` already wrote to `room_participants`. A signed-in user is recognised
 * from the same NextAuth cookie the REST routes read (the handshake is an ordinary HTTP request,
 * so the cookie is right there), and a guest presents the seat id their browser stored for this
 * room. Anything else is refused — there is no code path here that creates a seat, so a
 * connection can never mint a participant the REST layer has not seen.
 */

/** A refusal the connection middleware turns into Socket.io's `connect_error`. */
export class SocketAuthError extends Error {
  constructor(
    readonly code: SocketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SocketAuthError';
  }
}

/** The room code and optional seat id a handshake claims, once it is known to be well formed. */
export interface HandshakeClaim {
  roomCode: string;
  participantId: string | null;
}

/**
 * Reads the `auth` object off a handshake. Everything in it is attacker-controlled, so the only
 * thing taken on trust is its shape: the code has to parse, and the seat id is passed on as a
 * claim to be checked against the database, never as an identity.
 */
export function readHandshakeAuth(auth: unknown): HandshakeClaim {
  const claim = (auth ?? {}) as Partial<SocketHandshakeAuth>;

  if (typeof claim.roomCode !== 'string') {
    throw new SocketAuthError(SOCKET_ERROR_CODES.INVALID_HANDSHAKE, 'roomCode is required');
  }

  const roomCode = parseRoomCode(claim.roomCode);
  if (!roomCode) {
    throw new SocketAuthError(SOCKET_ERROR_CODES.INVALID_HANDSHAKE, 'roomCode is not a room code');
  }

  const participantId =
    typeof claim.participantId === 'string' && claim.participantId.length > 0
      ? claim.participantId
      : null;

  return { roomCode, participantId };
}

/**
 * The reads `resolveSocketParticipant` needs, as an interface rather than a pool: the decision
 * being made here (which seat does this connection own?) is worth testing on its own, without a
 * database, and `postgresLookup` is the one implementation that talks to Postgres.
 */
export interface ParticipantLookup {
  findRoom(code: string): Promise<Room | null>;
  findSeatForUser(roomId: string, userId: string): Promise<Participant | null>;
  findSeatById(roomId: string, participantId: string): Promise<Participant | null>;
}

export function postgresLookup(db: Queryable): ParticipantLookup {
  return {
    findRoom: (code) => findRoomByCode(db, code),
    findSeatForUser: (roomId, userId) => findParticipantByUserInRoom(db, roomId, userId),
    findSeatById: (roomId, participantId) => findParticipantInRoom(db, roomId, participantId),
  };
}

/** Everything the connection handler needs to know about a socket, resolved once at handshake. */
export interface SocketIdentity {
  room: Room;
  participant: Participant;
}

export interface ResolveSocketInput {
  claim: HandshakeClaim;
  /** The signed-in user behind the handshake cookie, or null for a guest. */
  userId: string | null;
}

/**
 * Resolves a handshake to the seat it owns, or throws.
 *
 * A signed-in caller is matched on `user_id` and their `participantId` claim is ignored
 * outright: it would let one account borrow another browser's seat. A guest's claim is only
 * honoured when the row really is a seat in this room *and* has no account behind it, so a
 * guest cannot present a signed-in member's id and inherit their votes.
 */
export async function resolveSocketParticipant(
  lookup: ParticipantLookup,
  { claim, userId }: ResolveSocketInput,
): Promise<SocketIdentity> {
  const room = await lookup.findRoom(claim.roomCode);
  if (!room) {
    throw new SocketAuthError(SOCKET_ERROR_CODES.ROOM_NOT_FOUND, 'room not found');
  }

  const participant = userId
    ? await lookup.findSeatForUser(room.id, userId)
    : claim.participantId
      ? await lookup.findSeatById(room.id, claim.participantId)
      : null;

  if (!participant || (!userId && participant.userId !== null)) {
    throw new SocketAuthError(
      SOCKET_ERROR_CODES.NOT_A_PARTICIPANT,
      'join the room before opening a realtime connection',
    );
  }

  return { room, participant };
}

/** The whole handshake, end to end: cookie → user, `auth` → claim, claim → seat. */
export async function authenticateHandshake(
  pool: pg.Pool,
  handshake: { auth: unknown; headers: { cookie?: string } },
): Promise<SocketIdentity> {
  const claim = readHandshakeAuth(handshake.auth);
  const caller = await resolveCallerFromCookieHeader(handshake.headers.cookie);
  return resolveSocketParticipant(postgresLookup(pool), { claim, userId: caller?.userId ?? null });
}
