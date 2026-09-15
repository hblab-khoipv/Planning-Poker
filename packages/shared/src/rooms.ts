import type { DeckType } from './decks.js';
import type { RoundStateDto } from './rounds.js';

/**
 * The wire shapes of the room REST API (PRD FR-1, FR-2, FR-3), shared so the browser and the
 * server cannot drift apart on a field name. Dates are ISO strings: JSON has no date type.
 */

export interface RoomDto {
  id: string;
  code: string;
  name: string;
  deckType: DeckType;
  /** The host's `users.id`, or null when a guest created the room (PRD §7). */
  hostId: string | null;
  /**
   * The host's seat. Set for every room, guest-hosted ones included, which is what gives a
   * guest-created room a host at all — see `apps/api/src/http/authority.ts`.
   */
  hostParticipantId: string | null;
  createdAt: string;
}

export interface ParticipantDto {
  id: string;
  /** The guest's typed name, or the signed-in user's account name. Never empty. */
  displayName: string;
  /** True when this seat has no account behind it (`room_participants.user_id` IS NULL). */
  isGuest: boolean;
  isHost: boolean;
  isOnline: boolean;
  joinedAt: string;
}

export interface CreateRoomRequest {
  name: string;
  deckType: DeckType;
  /** Display name for the creator's own seat. Required unless the request is authenticated. */
  displayName?: string;
}

export interface JoinRoomRequest {
  /** Required for guests; an optional per-room rename for signed-in users. */
  displayName?: string;
  /** A seat this browser already holds in this room, so a reload does not take a second one. */
  participantId?: string;
}

export interface CreateRoomResponse {
  room: RoomDto;
  participant: ParticipantDto;
}

export interface JoinRoomResponse {
  room: RoomDto;
  participant: ParticipantDto;
}

export interface RoomResponse {
  room: RoomDto;
}

export interface ParticipantsResponse {
  participants: ParticipantDto[];
}

/** `GET /rooms/:code/round` — the REST read of what the socket pushes as `room:state`. */
export type RoundStateResponse = RoundStateDto;

/** Every non-2xx response from the room API has this body. */
export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export const API_ERROR_CODES = ['validation_error', 'not_found', 'conflict', 'internal'] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Where the browser sends people to join a room, given its code. */
export function joinPath(code: string): string {
  return `/join/${encodeURIComponent(code)}`;
}

/** The room's own page — the half of the invite link after the origin. */
export function roomPath(code: string): string {
  return `/rooms/${encodeURIComponent(code)}`;
}
