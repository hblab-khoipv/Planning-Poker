import type { ParticipantDto } from './rooms.js';

/** Socket.io event names shared by the API and the web client (PRD §8). */
export const SOCKET_EVENTS = {
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_STATE: 'room:state',
  PARTICIPANT_JOINED: 'participant:joined',
  PARTICIPANT_LEFT: 'participant:left',
  VOTE_CAST: 'vote:cast',
  ROUND_REVEALED: 'round:revealed',
  ROUND_RESET: 'round:reset',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Key used to persist the guest identity in browser storage (PRD §6, guest session). */
export const PARTICIPANT_ID_STORAGE_KEY = 'planning-poker:participant-id';

/**
 * What the client presents in the Socket.io handshake (`io(url, { auth })`).
 *
 * A connection is scoped to exactly one room, and the identity behind it is never taken from
 * this object alone: a signed-in user is recognised from the NextAuth cookie that rides along
 * with the handshake, and `participantId` is only honoured for a guest seat that
 * `POST /rooms/:code/join` already created in this very room. See
 * `apps/api/src/realtime/identity.ts`.
 */
export interface SocketHandshakeAuth {
  roomCode: string;
  /** The seat this browser holds in this room; guests have nothing else to identify them by. */
  participantId?: string | null;
}

/**
 * Snapshot pushed to a socket the moment it joins a room's channel.
 *
 * Not one of PRD §8's product events — it is transport plumbing. Without it a client would have
 * to reconcile a REST read against events that may have fired while that read was in flight.
 */
export interface RoomStatePayload {
  roomCode: string;
  participants: ParticipantDto[];
}

/** PRD §8 `participant:joined` — "participant info". */
export interface ParticipantJoinedPayload {
  participant: ParticipantDto;
}

/** PRD §8 `participant:left` — "participant_id". */
export interface ParticipantLeftPayload {
  participantId: string;
}

/**
 * PRD §8 `vote:cast` — "participant_id, has_voted = true".
 *
 * Deliberately has no field for the value: FR-4 keeps every vote secret until the host reveals,
 * so the event that announces a vote cannot carry one. Task 6 emits this from the cast handler;
 * the reveal payload is a separate event with a separate shape.
 */
export interface VoteCastPayload {
  participantId: string;
  hasVoted: true;
}

/** Server→client events. Typed as one map so neither side can invent a payload shape. */
export interface ServerToClientEvents {
  [SOCKET_EVENTS.ROOM_STATE]: (payload: RoomStatePayload) => void;
  [SOCKET_EVENTS.PARTICIPANT_JOINED]: (payload: ParticipantJoinedPayload) => void;
  [SOCKET_EVENTS.PARTICIPANT_LEFT]: (payload: ParticipantLeftPayload) => void;
  [SOCKET_EVENTS.VOTE_CAST]: (payload: VoteCastPayload) => void;
}

/** Client→server events. Empty until task 6 adds the vote-casting handler. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientToServerEvents {}

/**
 * Why a connection was refused, sent as the `message` of Socket.io's `connect_error`.
 * The browser uses these to tell "join over REST first" from "this room is gone".
 */
export const SOCKET_ERROR_CODES = {
  INVALID_HANDSHAKE: 'invalid_handshake',
  ROOM_NOT_FOUND: 'room_not_found',
  NOT_A_PARTICIPANT: 'not_a_participant',
} as const;

export type SocketErrorCode = (typeof SOCKET_ERROR_CODES)[keyof typeof SOCKET_ERROR_CODES];
