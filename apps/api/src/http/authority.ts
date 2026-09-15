/**
 * Who may reveal a round or start a new one (PRD FR-5, FR-7).
 *
 * PRD §12 leaves "Ai được quyền bấm 'Lộ bài' — chỉ host, hay bất kỳ ai trong phòng?" open; the
 * MVP answer is host-only, because reveal is the one irreversible action in a round and FR-4's
 * whole point is that nobody can turn the cards over early.
 *
 * "Host" is the OR of two facts, and it needs to be, because a room has two kinds of creator:
 *
 * - `rooms.host_id` is the creator's **account**, and is NULL whenever a guest created the room.
 * - `rooms.host_participant_id` is the creator's **seat** (migration 0004), and is set for every
 *   room regardless of whether anybody signed in.
 *
 * Matching either one means a signed-in host keeps their room even if their seat is deleted and
 * retaken, while a guest host — who has no account to match on — still owns theirs. There is
 * deliberately no third branch: a room with neither recorded has no host, and `false` is the
 * safe answer, since the alternative is letting any participant reveal somebody else's cards.
 *
 * This is a pure function of two rows so it can be unit tested exhaustively, and it is the only
 * place the question is answered — `http/dto.ts` renders the Host badge from it and
 * `realtime/voting.ts` gates the actions on it, so the badge and the permission cannot disagree.
 */

/** The half of a room this decision depends on. */
export interface HostRef {
  hostId: string | null;
  hostParticipantId: string | null;
}

/** The half of a participant this decision depends on. */
export interface SeatRef {
  id: string;
  userId: string | null;
}

export function isRoomHost(room: HostRef, seat: SeatRef): boolean {
  if (room.hostParticipantId !== null && seat.id === room.hostParticipantId) return true;
  return room.hostId !== null && seat.userId !== null && seat.userId === room.hostId;
}
