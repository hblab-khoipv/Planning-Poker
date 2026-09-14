import {
  type ClientToServerEvents,
  type ParticipantDto,
  type RoundRevealedPayload,
  type RoundResetPayload,
  SOCKET_EVENTS,
  type ServerToClientEvents,
  type VoteCastPayload,
} from '@planning-poker/shared';
import type { Server } from 'socket.io';

/**
 * Room scoping and every emitter the realtime layer has.
 *
 * Every broadcast goes through one of these functions, so "what can this server possibly send to
 * a room?" is answered by reading this file. That matters for FR-4: `emitVoteCast` takes a
 * participant id and nothing else, so there is no way to put a vote value on the wire while a
 * round is still being voted on. Exactly one emitter carries card values — `emitRoundRevealed` —
 * and its payload can only be built by `toRoundStateDto` from a round the database already
 * records as `revealed` (see `voting.ts`).
 */

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * One Socket.io room per room code. The prefix keeps these from ever colliding with the
 * per-socket rooms Socket.io creates automatically (those are named after the socket id).
 */
export function roomChannel(roomCode: string): string {
  return `room:${roomCode}`;
}

export function emitParticipantJoined(
  io: RealtimeServer,
  roomCode: string,
  participant: ParticipantDto,
): void {
  io.to(roomChannel(roomCode)).emit(SOCKET_EVENTS.PARTICIPANT_JOINED, { participant });
}

export function emitParticipantLeft(
  io: RealtimeServer,
  roomCode: string,
  participantId: string,
): void {
  io.to(roomChannel(roomCode)).emit(SOCKET_EVENTS.PARTICIPANT_LEFT, { participantId });
}

/**
 * Announces that somebody has voted, without saying what they voted (PRD §8, FR-4).
 *
 * The payload is built here, from an id, and the function has no parameter a value could
 * arrive through — which is what keeps the secrecy guarantee structural rather than a rule
 * the cast handler has to remember.
 */
export function voteCastPayload(participantId: string): VoteCastPayload {
  return { participantId, hasVoted: true };
}

export function emitVoteCast(io: RealtimeServer, roomCode: string, participantId: string): void {
  io.to(roomChannel(roomCode)).emit(SOCKET_EVENTS.VOTE_CAST, voteCastPayload(participantId));
}

/**
 * PRD §8 `round:revealed` — the one broadcast that carries card values.
 *
 * It takes a finished payload rather than a round id and a list of votes, because assembling it
 * is the step that has to check the round's status. `voting.ts` builds it with `toRoundStateDto`
 * from a round Postgres has already flipped to `revealed`; a round still being voted on cannot
 * produce a payload with values in it, so there is nothing here to get wrong.
 */
export function emitRoundRevealed(
  io: RealtimeServer,
  roomCode: string,
  payload: RoundRevealedPayload,
): void {
  io.to(roomChannel(roomCode)).emit(SOCKET_EVENTS.ROUND_REVEALED, payload);
}

/** PRD §8 `round:reset` — a new round is open, so every client clears its local vote state. */
export function emitRoundReset(
  io: RealtimeServer,
  roomCode: string,
  payload: RoundResetPayload,
): void {
  io.to(roomChannel(roomCode)).emit(SOCKET_EVENTS.ROUND_RESET, payload);
}
