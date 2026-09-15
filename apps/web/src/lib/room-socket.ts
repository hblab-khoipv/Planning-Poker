import {
  type ActionAck,
  type ClientToServerEvents,
  type ParticipantDto,
  type RevealedVoteDto,
  SOCKET_ERROR_CODES,
  SOCKET_EVENTS,
  type ServerToClientEvents,
  type SocketHandshakeAuth,
  VOTE_ERROR_CODES,
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

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

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

/**
 * Sends one action and resolves with the server's answer (FR-4, FR-5, FR-7).
 *
 * Every action is acknowledged rather than fire-and-forget, because each one can be refused for
 * a reason the person needs to see: a card that is not in this room's deck, a round somebody
 * else already revealed, or an action only the host may take. A socket that has dropped would
 * otherwise leave the click looking like it worked.
 */
function requestAction(
  socket: RoomSocket,
  send: (ack: (result: ActionAck) => void) => void,
): Promise<ActionAck> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({
        ok: false,
        code: VOTE_ERROR_CODES.INTERNAL,
        message: 'Mất kết nối tới phòng, đang thử lại…',
      });
      return;
    }
    send(resolve);
  });
}

/** FR-4: choose a card, or change the one already chosen. */
export function castVote(socket: RoomSocket, value: string): Promise<ActionAck> {
  return requestAction(socket, (ack) => socket.emit(SOCKET_EVENTS.VOTE_CAST, { value }, ack));
}

/** FR-5: turn every card over. The server refuses anybody who is not the host. */
export function revealRound(socket: RoomSocket): Promise<ActionAck> {
  return requestAction(socket, (ack) => socket.emit(SOCKET_EVENTS.ROUND_REVEAL, ack));
}

/**
 * FR-7: start the next round.
 *
 * "Vote lại" (same item) and "Round mới" (next item) both call this — PRD §8 has one
 * `round:reset` event and §7 one "mỗi lần Round mới tạo 1 record", so the two buttons differ
 * only in the label the user reads. See `apps/api/src/realtime/voting.ts`.
 */
export function resetRound(socket: RoomSocket): Promise<ActionAck> {
  return requestAction(socket, (ack) => socket.emit(SOCKET_EVENTS.ROUND_RESET, ack));
}

/** What a refused action should say, in words a Vietnamese-speaking user can act on. */
export function messageForActionError(ack: ActionAck): string | null {
  if (ack.ok) return null;
  switch (ack.code) {
    case VOTE_ERROR_CODES.NOT_HOST:
      return 'Chỉ host mới lộ bài hoặc mở round mới được.';
    case VOTE_ERROR_CODES.ROUND_NOT_OPEN:
      return 'Round này đã lộ bài, hãy chờ host mở round mới.';
    case VOTE_ERROR_CODES.INVALID_CARD:
      return 'Thẻ này không thuộc bộ thẻ của phòng.';
    case VOTE_ERROR_CODES.NO_ROUND:
      return 'Phòng chưa có round nào.';
    default:
      return ack.message;
  }
}

/**
 * Applies one `vote:cast` to the set of people who have voted.
 *
 * A Set rather than a list because the event repeats every time somebody changes their mind
 * (FR-4 allows that until the reveal), and "Lan has voted" is true once however many cards she
 * tried. Returns the same set unchanged when there is nothing new, so React can skip a render.
 */
export function applyVoteCast(voted: ReadonlySet<string>, participantId: string): Set<string> {
  if (voted.has(participantId)) return voted as Set<string>;
  return new Set(voted).add(participantId);
}

/** Card values by participant id — how the results table looks a person's vote up. */
export function votesByParticipant(votes: readonly RevealedVoteDto[]): Map<string, string> {
  return new Map(votes.map((vote) => [vote.participantId, vote.value]));
}
