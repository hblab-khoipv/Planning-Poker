import type { ParticipantDto } from './rooms.js';
import type { RevealedVoteDto, RoundDto, RoundStateDto } from './rounds.js';
import type { RoundTally } from './tally.js';

/** Socket.io event names shared by the API and the web client (PRD §8). */
export const SOCKET_EVENTS = {
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_STATE: 'room:state',
  PARTICIPANT_JOINED: 'participant:joined',
  PARTICIPANT_LEFT: 'participant:left',
  VOTE_CAST: 'vote:cast',
  /** Client→server: changing one's own card on a round the room has already seen (issue #11). */
  VOTE_EDIT: 'vote:edit',
  /** Server→client: somebody's revealed card was replaced, with the old one still attached. */
  VOTE_EDITED: 'vote:edited',
  /** Client→server: the host asking for the cards to be turned over. */
  ROUND_REVEAL: 'round:reveal',
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
 *
 * It extends `RoundStateDto` with one field no broadcast may ever carry: `myVote`, the card this
 * particular socket's own seat has chosen. It is safe here and nowhere else, because `room:state`
 * is emitted to a single socket (`socket.emit`), never to the room. That is what lets somebody
 * who reloaded mid-round see their own selection again without learning anybody else's.
 */
export interface RoomStatePayload extends RoundStateDto {
  roomCode: string;
  participants: ParticipantDto[];
  /** This socket's own card in the current round, or null. Never another participant's. */
  myVote: string | null;
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
 * so the event that announces a vote cannot carry one. The reveal payload is a separate event
 * with a separate shape.
 */
export interface VoteCastPayload {
  participantId: string;
  hasVoted: true;
}

/**
 * PRD §8 `round:revealed` — "toàn bộ votes của round, avg, median".
 *
 * The round is included so a client that missed the reset still knows which round these values
 * belong to and can discard them if it has already moved on.
 */
export interface RoundRevealedPayload {
  round: RoundDto;
  votes: RevealedVoteDto[];
  tally: RoundTally;
}

/**
 * Issue #11's edit-after-reveal, announced to the whole room.
 *
 * The cards are already public by the time this can fire — the round is `revealed` or the handler
 * refuses — so unlike `vote:cast` this event may carry values. It carries *every* vote rather than
 * only the changed one for the same reason `round:reset` carries the new round: a client applies
 * it by replacing the round's votes and tally wholesale, so two edits arriving out of order
 * cannot leave a screen showing one person's new card beside a stale average.
 *
 * `participantId` is who did the editing, so a client can point at the change without diffing
 * two snapshots.
 */
export interface VoteEditedPayload {
  participantId: string;
  round: RoundDto;
  votes: RevealedVoteDto[];
  tally: RoundTally;
}

/**
 * PRD §8 `round:reset` — "round_id mới, status = voting".
 *
 * Carrying the new round rather than a bare "clear yourself" is what makes the event idempotent:
 * a client applies it by replacing its round, so receiving it twice cannot wipe votes cast in
 * between.
 */
export interface RoundResetPayload {
  round: RoundDto;
}

/**
 * What the client sends when somebody picks a card. The value is checked against the deck.
 *
 * `vote:edit` reuses this shape deliberately: an edit is the same "here is my card" message, and
 * *whose* card it is is settled by the handshake either way. There is no participant id a caller
 * could put here, which is what makes "only the owner may edit their own vote" (issue #11)
 * structural rather than a check the handler has to remember — see
 * `apps/api/src/realtime/voting.ts`.
 */
export interface VoteCastRequest {
  value: string;
}

/**
 * Why an action was refused, returned in the acknowledgement rather than thrown at the socket.
 *
 * A refusal is per-action and private to the caller: telling the whole room that somebody who
 * is not the host tried to reveal would be noise, and `connect_error` would tear down a
 * perfectly good connection over a single bad click.
 */
export const VOTE_ERROR_CODES = {
  NOT_HOST: 'not_host',
  NO_ROUND: 'no_round',
  ROUND_NOT_OPEN: 'round_not_open',
  /** An edit aimed at a round whose cards are still face down — that is a plain vote. */
  ROUND_NOT_REVEALED: 'round_not_revealed',
  /** There is no card of this person's to edit: they never voted in this round. */
  NO_VOTE: 'no_vote',
  INVALID_CARD: 'invalid_card',
  INTERNAL: 'internal',
} as const;

export type VoteErrorCode = (typeof VOTE_ERROR_CODES)[keyof typeof VOTE_ERROR_CODES];

/** Every client→server action answers with this, so the browser can show what went wrong. */
export type ActionAck = { ok: true } | { ok: false; code: VoteErrorCode; message: string };

export type AckFn = (ack: ActionAck) => void;

/** Server→client events. Typed as one map so neither side can invent a payload shape. */
export interface ServerToClientEvents {
  [SOCKET_EVENTS.ROOM_STATE]: (payload: RoomStatePayload) => void;
  [SOCKET_EVENTS.PARTICIPANT_JOINED]: (payload: ParticipantJoinedPayload) => void;
  [SOCKET_EVENTS.PARTICIPANT_LEFT]: (payload: ParticipantLeftPayload) => void;
  [SOCKET_EVENTS.VOTE_CAST]: (payload: VoteCastPayload) => void;
  [SOCKET_EVENTS.VOTE_EDITED]: (payload: VoteEditedPayload) => void;
  [SOCKET_EVENTS.ROUND_REVEALED]: (payload: RoundRevealedPayload) => void;
  [SOCKET_EVENTS.ROUND_RESET]: (payload: RoundResetPayload) => void;
}

/**
 * Client→server events (FR-4, FR-5, FR-7).
 *
 * `vote:cast` appears in both maps with different payloads, which is the PRD §8 contract made
 * literal: what a client sends is a card, what the server relays is the fact that a card was
 * sent. `round:reveal` and `round:reset` carry no payload at all — who is asking is settled by
 * the handshake, and which round it applies to is always the room's current one, so there is
 * nothing for a caller to get wrong or to forge. `vote:edit` (issue #11) is the same message as
 * `vote:cast` aimed at a round that is already revealed; it too names no participant, so it can
 * only ever move the sender's own card.
 */
export interface ClientToServerEvents {
  [SOCKET_EVENTS.VOTE_CAST]: (payload: VoteCastRequest, ack?: AckFn) => void;
  [SOCKET_EVENTS.VOTE_EDIT]: (payload: VoteCastRequest, ack?: AckFn) => void;
  [SOCKET_EVENTS.ROUND_REVEAL]: (ack?: AckFn) => void;
  [SOCKET_EVENTS.ROUND_RESET]: (ack?: AckFn) => void;
}

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
