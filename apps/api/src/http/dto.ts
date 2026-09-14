import type { ParticipantDto, RoomDto } from '@planning-poker/shared';
import type { Participant, Room } from '../db/repositories/index.js';
import type { ParticipantWithUser } from '../db/repositories/participants.js';

/** Row shapes are internal; these are the only things that go over the wire. */

export function toRoomDto(room: Room): RoomDto {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    deckType: room.deckType,
    hostId: room.hostId,
    createdAt: room.createdAt.toISOString(),
  };
}

/** Shown when a seat somehow has neither a per-room name nor an account name. */
export const FALLBACK_DISPLAY_NAME = 'Khách';

/**
 * A per-room name always wins: PRD §3.1.2 lets a signed-in member rename themselves for one
 * room without touching their account.
 */
export function participantDisplayName(guestName: string | null, userName: string | null): string {
  return guestName ?? userName ?? FALLBACK_DISPLAY_NAME;
}

export function toParticipantDto(
  participant: Participant | ParticipantWithUser,
  options: { userName?: string | null; hostId: string | null },
): ParticipantDto {
  const userName = 'userName' in participant ? participant.userName : (options.userName ?? null);

  return {
    id: participant.id,
    displayName: participantDisplayName(participant.guestName, userName),
    isGuest: participant.userId === null,
    isHost: participant.userId !== null && participant.userId === options.hostId,
    isOnline: participant.isOnline,
    joinedAt: participant.joinedAt.toISOString(),
  };
}
