import type { ParticipantDto, RoomDto } from './rooms.js';
import type { RoundDto, RoundStateDto } from './rounds.js';

/**
 * Session history (PRD §3.1.10, §4 step 9, FR-9, §9.6).
 *
 * History exists for one kind of person only: somebody with an account. A guest is identified by
 * a participant id their own browser stores, which is scoped to a single room and vanishes with
 * it — there is nothing to hang a list of past sessions on, and keying history on such an id
 * would hand anybody who guessed one somebody else's meetings. So every shape below is reached
 * through `room_participants.user_id`, and none of them has a guest variant.
 */

/**
 * One row of "phòng tôi đã tham gia". Deliberately a summary: PRD §9.6's list screen shows
 * enough to recognise a session, and the rounds themselves are one click further in.
 */
export interface RoomHistoryEntryDto {
  room: RoomDto;
  /** How many seats the room has — the "6 người" on the card, guests included. */
  participantCount: number;
  roundCount: number;
  revealedRoundCount: number;
  /**
   * When the room last had its cards turned over, or null for a room where nobody ever
   * revealed. The list screen says "chưa có round nào được Lật bài" rather than hiding the room:
   * a session that ended without a reveal is still a session the user was in.
   */
  lastRevealedAt: string | null;
  /** `rooms.last_active_at` — what the list is ordered by, newest first. */
  lastActiveAt: string;
}

/** `GET /users/me/rooms`. Empty for a signed-in user who has never joined anything. */
export interface RoomHistoryResponse {
  rooms: RoomHistoryEntryDto[];
}

/**
 * One past round, in exactly the shape the live room uses.
 *
 * This extends `RoundStateDto` instead of inventing a history-only payload so that both come out
 * of the server's one secrecy choke point (`apps/api/src/http/dto.ts`): a round still `voting`
 * carries no card values here either, even though the request happens long after the fact. The
 * only narrowing is `round`, which is never null in a history entry — the entry *is* a round.
 */
export interface RoundHistoryEntryDto extends RoundStateDto {
  round: RoundDto;
}

/** `GET /rooms/:code/rounds` — one room's whole history, in round order. */
export interface RoomHistoryDetailResponse {
  room: RoomDto;
  /** Every seat in the room, so a vote's `participantId` can be shown as a name. */
  participants: ParticipantDto[];
  rounds: RoundHistoryEntryDto[];
}

/** PRD §9.6's list screen. */
export function historyPath(): string {
  return '/history';
}

/** The drill-in: one room's past rounds. */
export function roomHistoryPath(code: string): string {
  return `/history/${encodeURIComponent(code)}`;
}
