import {
  type ParticipantDto,
  SOCKET_EVENTS,
  type ServerToClientEvents,
  type VoteCastPayload,
} from '@planning-poker/shared';
import type { Server } from 'socket.io';

/**
 * Room scoping and the only three emitters the realtime layer has.
 *
 * Every broadcast goes through one of these functions, so "what can this server possibly send to
 * a room?" is answered by reading this file. That matters for FR-4: `emitVoteCast` takes a
 * participant id and nothing else, so there is no way — now or in task 6 — to put a vote value
 * on the wire before the host reveals. The reveal event is deliberately absent; it belongs to
 * task 6 together with the logic that decides a round may be revealed at all.
 */

export type RealtimeServer = Server<Record<string, never>, ServerToClientEvents>;

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
 * Nothing calls this yet — task 6 owns the cast handler. It exists now so that the shape is
 * fixed before there is any pressure to "just include the value": the payload is built here,
 * from an id, and the function has no parameter a value could arrive through.
 */
export function voteCastPayload(participantId: string): VoteCastPayload {
  return { participantId, hasVoted: true };
}

export function emitVoteCast(io: RealtimeServer, roomCode: string, participantId: string): void {
  io.to(roomChannel(roomCode)).emit(SOCKET_EVENTS.VOTE_CAST, voteCastPayload(participantId));
}
