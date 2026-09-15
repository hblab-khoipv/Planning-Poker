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
 * Two facts, and both are required:
 *
 * - There is a signed-in caller at all. A guest is identified by a participant id their own
 *   browser holds, which names a seat in one room and nothing else; honouring it here would turn
 *   any leaked or guessed seat id into a key to that room's past votes, and there is no account
 *   for the history to belong to anyway (PRD §3.1.10: "chỉ cho user đã đăng nhập").
 * - That account holds a seat in this room. Not "the room exists" and not "the caller is the
 *   host" — FR-9 is about the sessions *you took part in*, so a signed-in stranger is refused
 *   exactly like a guest is.
 *
 * Deliberately a pure predicate over two booleans rather than a function that queries: the
 * membership read belongs to `isRoomMember`, and keeping the decision separate from the lookup
 * is what lets both outcomes be asserted directly. Compare `http/authority.ts`, which answers
 * the neighbouring question of who may *reveal*.
 */
export function canViewRoomHistory(options: {
  callerUserId: string | null;
  isMember: boolean;
}): boolean {
  if (options.callerUserId === null) return false;
  return options.isMember;
}
