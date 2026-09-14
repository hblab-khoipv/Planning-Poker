import { describe, expect, it } from 'vitest';
import { isRoomHost } from './authority.js';

/**
 * Who may reveal (PRD §12's open question, resolved as host-only for the MVP).
 *
 * The matrix matters more than any single case: the two halves of host authority exist because
 * a room can be created by somebody with an account or by somebody without one, and the second
 * kind has no `host_id` at all. A regression that dropped either branch would look fine in one
 * kind of room and lock the other one out of its own reveal button.
 */

const HOST_SEAT = '11111111-1111-4111-8111-111111111111';
const OTHER_SEAT = '22222222-2222-4222-8222-222222222222';
const HOST_USER = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';

describe('isRoomHost', () => {
  describe('a guest-hosted room (host_id IS NULL)', () => {
    const room = { hostId: null, hostParticipantId: HOST_SEAT };

    it('recognises the creator by their seat', () => {
      expect(isRoomHost(room, { id: HOST_SEAT, userId: null })).toBe(true);
    });

    it('refuses every other guest in the room', () => {
      expect(isRoomHost(room, { id: OTHER_SEAT, userId: null })).toBe(false);
    });

    it('refuses a signed-in member who is not on the host seat', () => {
      expect(isRoomHost(room, { id: OTHER_SEAT, userId: OTHER_USER })).toBe(false);
    });
  });

  describe('a member-hosted room', () => {
    const room = { hostId: HOST_USER, hostParticipantId: HOST_SEAT };

    it('recognises the host by their seat', () => {
      expect(isRoomHost(room, { id: HOST_SEAT, userId: HOST_USER })).toBe(true);
    });

    it('recognises the host by their account even from another seat', () => {
      // A seat can be deleted and retaken; the account still owns the room.
      expect(isRoomHost(room, { id: OTHER_SEAT, userId: HOST_USER })).toBe(true);
    });

    it('refuses another member and every guest', () => {
      expect(isRoomHost(room, { id: OTHER_SEAT, userId: OTHER_USER })).toBe(false);
      expect(isRoomHost(room, { id: OTHER_SEAT, userId: null })).toBe(false);
    });
  });

  describe('a room with no host recorded at all', () => {
    const room = { hostId: null, hostParticipantId: null };

    it('has no host, rather than everybody being one', () => {
      expect(isRoomHost(room, { id: HOST_SEAT, userId: null })).toBe(false);
      expect(isRoomHost(room, { id: OTHER_SEAT, userId: OTHER_USER })).toBe(false);
    });

    it('does not let a guest match the null host account', () => {
      // The bug this pins: `seat.userId === room.hostId` is true when both are null.
      expect(
        isRoomHost({ hostId: null, hostParticipantId: null }, { id: OTHER_SEAT, userId: null }),
      ).toBe(false);
    });
  });
});
