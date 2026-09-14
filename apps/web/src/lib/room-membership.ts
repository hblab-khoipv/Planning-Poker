import type { IdentityStore } from '@/lib/guest-identity';

/**
 * Which seat this browser holds in which room.
 *
 * A guest has no account for the server to key on, so `POST /rooms/:code/join` hands back the
 * `room_participants.id` it created and the browser remembers it — presenting it again on the
 * next join keeps the same seat (and, from task 6, the same vote) instead of taking a second
 * one. It is stored per room rather than globally because the browser's single guest identity
 * (`@/lib/guest-identity`) can be seated in several rooms at the same time, and a
 * `room_participants` row belongs to exactly one of them.
 *
 * Signed-in users do not need any of this: the server matches them on `user_id`.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function membershipStorageKey(roomCode: string): string {
  return `planning-poker:room:${roomCode.toUpperCase()}:participant-id`;
}

export function readRoomMembership(store: IdentityStore, roomCode: string): string | null {
  const stored = store.getItem(membershipStorageKey(roomCode));
  return stored && UUID_PATTERN.test(stored) ? stored : null;
}

export function saveRoomMembership(
  store: IdentityStore,
  roomCode: string,
  participantId: string,
): void {
  if (!UUID_PATTERN.test(participantId)) {
    throw new Error(`not a participant id: ${participantId}`);
  }
  store.setItem(membershipStorageKey(roomCode), participantId);
}

export function clearRoomMembership(store: IdentityStore, roomCode: string): void {
  store.removeItem(membershipStorageKey(roomCode));
}
