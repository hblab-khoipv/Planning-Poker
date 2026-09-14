import {
  type ParticipantDto,
  SOCKET_ERROR_CODES,
  SOCKET_EVENTS,
  type ServerToClientEvents,
  type SocketHandshakeAuth,
} from '@planning-poker/shared';
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl } from '@/lib/api-client';

/**
 * The browser's side of the realtime room channel (PRD FR-3, §8).
 *
 * A connection is scoped to one room and carries no identity of its own: the seat id this
 * browser stored when it joined over REST goes in the handshake, and `withCredentials` sends
 * NextAuth's session cookie so a signed-in member is recognised without one. The API refuses
 * anything it cannot match to an existing `room_participants` row, which is why only somebody
 * who has actually joined opens a socket at all.
 */

export type RoomSocket = Socket<ServerToClientEvents, Record<string, never>>;

export interface RoomSocketOptions {
  roomCode: string;
  /** The seat this browser holds in this room; a viewer who has not joined has none. */
  participantId: string;
}

export function connectToRoom({ roomCode, participantId }: RoomSocketOptions): RoomSocket {
  const auth: SocketHandshakeAuth = { roomCode, participantId };

  return io(apiBaseUrl(), {
    auth,
    withCredentials: true,
    // The seat outlives the socket, so reconnecting is always the right answer to a drop; the
    // server's grace window is what stops a brief one from looking like a departure.
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
}

/** What a refused handshake means, in words a Vietnamese-speaking user can act on. */
export function messageForSocketError(error: Error): string {
  switch (error.message) {
    case SOCKET_ERROR_CODES.NOT_A_PARTICIPANT:
      return 'Bạn chưa tham gia phòng này. Hãy vào phòng để xem danh sách trực tiếp.';
    case SOCKET_ERROR_CODES.ROOM_NOT_FOUND:
      return 'Không tìm thấy phòng với mã này.';
    default:
      return 'Mất kết nối real-time, đang thử kết nối lại…';
  }
}

/**
 * Applies one `participant:joined` to a list.
 *
 * Matching on id rather than appending is what makes the stream safe to replay: the snapshot a
 * socket receives on connect already contains everybody, and the same person can be announced
 * again after a genuine rejoin. Join order is preserved because the server sends the list in it
 * and a re-announcement updates in place.
 */
export function applyParticipantJoined(
  participants: readonly ParticipantDto[],
  joined: ParticipantDto,
): ParticipantDto[] {
  const index = participants.findIndex((participant) => participant.id === joined.id);
  if (index === -1) return [...participants, joined];

  const next = [...participants];
  next[index] = joined;
  return next;
}

/**
 * Applies one `participant:left`.
 *
 * The seat stays in the list, greyed out via `isOnline` (PRD §7's `room_participants.is_online`)
 * — leaving a round is not the same as forfeiting it, and in task 6 that seat still holds a vote.
 */
export function applyParticipantLeft(
  participants: readonly ParticipantDto[],
  participantId: string,
): ParticipantDto[] {
  return participants.map((participant) =>
    participant.id === participantId ? { ...participant, isOnline: false } : participant,
  );
}

export { SOCKET_EVENTS };
