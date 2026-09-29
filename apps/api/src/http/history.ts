import type {
  RoomHistoryEntryDto,
  RoundHistoryEntryDto,
  RoundStateDto,
} from '@planning-poker/shared';
import type { RoomHistoryEntry, RoundWithVotes } from '../db/repositories/history.js';
import type { Room } from '../db/repositories/index.js';
import { toRoomDto, toRoundStateDto } from './dto.js';

/**
 * Wire shapes for session history (PRD FR-9), and the one rule that decides who may ask for it.
 *
 * Everything here is a pure function of rows already fetched, so the interesting decisions —
 * what a non-member is told, and what a round that was never revealed gives up — are unit
 * testable without a database or a socket.
 */

export function toRoomHistoryEntryDto(entry: RoomHistoryEntry): RoomHistoryEntryDto {
  return {
    room: toRoomDto(entry.room),
    participantCount: entry.participantCount,
    roundCount: entry.roundCount,
    revealedRoundCount: entry.revealedRoundCount,
    lastRevealedAt: entry.lastRevealedAt?.toISOString() ?? null,
    lastActiveAt: entry.room.lastActiveAt.toISOString(),
  };
}

/**
 * One past round, as much of it as the caller is allowed to see.
 *
 * The whole body is a call to `toRoundStateDto`, on purpose. FR-4's secrecy rule is that a card
 * value exists on the wire only for a round the database records as `revealed`, and history is
 * where that rule is easiest to lose: the request arrives long after the meeting, so it *feels*
 * like everything is past tense. It is not — a room abandoned mid-round still holds a `voting`
 * round whose votes were never meant to be public, and re-deriving "it's history, show it all"
 * here would publish them. Routing through the same choke point the live room uses means this
 * endpoint cannot hold a different opinion from the socket about any round.
 *
 * The cast narrows `round` from `RoundDto | null`: the argument is a row that exists, so
 * `toRoundStateDto` cannot have returned the null-round case.
 */
export function toRoundHistoryEntryDto(
  entry: RoundWithVotes,
  deckType: Room['deckType'],
): RoundHistoryEntryDto {
  const state: RoundStateDto = toRoundStateDto(entry.round, entry.votes, deckType);
  return state as RoundHistoryEntryDto;
}

/**
 * Whether this caller may read one room's history.
 *
 * Two independent ways in, and matching either is enough:
 *
 * - **An account with a seat in this room.** FR-9's own rule, unchanged: not "the room exists"
 *   and not "the caller is the host", so a signed-in stranger is refused. This is the one that
 *   works from the history screens, long after the meeting and from any browser.
 * - **A seat in this room, held right now.** The in-room history panel and its export, added for
 *   the round-history/export work. A guest is identified by the participant id their own browser
 *   stored when they joined (`lib/room-membership.ts`), which is the same credential the socket
 *   already accepts (`realtime/identity.ts`) — and that socket streams this room's revealed
 *   rounds live. Honouring it here therefore grants nothing new; refusing it would mean the
 *   primary MVP flow, a guest-hosted room, had a history panel nobody in the room could open.
 *
 * Still deliberately a pure predicate over booleans rather than a function that queries: the two
 * lookups belong to `isRoomMember` and `findParticipantInRoom`, and keeping the decision apart
 * from them is what lets every outcome be asserted directly. Compare `http/authority.ts`, which
 * answers the neighbouring question of who may *reveal*.
 */
export function canViewRoomHistory(options: {
  callerUserId: string | null;
  isMember: boolean;
  /** The caller presented a participant id that names a seat in this very room. */
  hasSeatInRoom?: boolean;
}): boolean {
  if (options.hasSeatInRoom === true) return true;
  if (options.callerUserId === null) return false;
  return options.isMember;
}
