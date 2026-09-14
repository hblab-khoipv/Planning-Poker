import { describe, expect, it } from 'vitest';
import type { Participant, Room } from '../db/repositories/index.js';
import {
  FALLBACK_DISPLAY_NAME,
  participantDisplayName,
  toParticipantDto,
  toRoomDto,
} from './dto.js';

const HOST_USER_ID = '11111111-1111-4111-8111-111111111111';

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    roomId: '33333333-3333-4333-8333-333333333333',
    userId: null,
    guestName: 'Khôi',
    joinedAt: new Date('2026-09-14T10:00:00.000Z'),
    isOnline: true,
    ...overrides,
  };
}

describe('participantDisplayName', () => {
  it('prefers the per-room name, which is how a signed-in member renames themselves', () => {
    expect(participantDisplayName('Khôi (QA)', 'Phạm Văn Khôi')).toBe('Khôi (QA)');
  });

  it('falls back to the account name when no per-room name was given', () => {
    expect(participantDisplayName(null, 'Phạm Văn Khôi')).toBe('Phạm Văn Khôi');
  });

  it('never returns an empty label', () => {
    expect(participantDisplayName(null, null)).toBe(FALLBACK_DISPLAY_NAME);
  });
});

describe('toParticipantDto', () => {
  it('marks a seat with no user id as a guest and never as host', () => {
    const dto = toParticipantDto(participant(), { hostId: HOST_USER_ID });

    expect(dto).toMatchObject({ displayName: 'Khôi', isGuest: true, isHost: false });
    expect(dto.joinedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('marks the room host', () => {
    const dto = toParticipantDto(participant({ userId: HOST_USER_ID, guestName: null }), {
      userName: 'Host',
      hostId: HOST_USER_ID,
    });

    expect(dto).toMatchObject({ displayName: 'Host', isGuest: false, isHost: true });
  });

  it('does not call a guest-hosted room’s guests hosts, even though both host ids are null', () => {
    const dto = toParticipantDto(participant(), { hostId: null });

    expect(dto.isHost).toBe(false);
  });

  it('reads the account name off a row that already joined users', () => {
    const dto = toParticipantDto(
      { ...participant({ userId: HOST_USER_ID, guestName: null }), userName: 'Joined name' },
      { hostId: null },
    );

    expect(dto.displayName).toBe('Joined name');
  });
});

describe('toRoomDto', () => {
  it('serialises dates as ISO strings and keeps the join code', () => {
    const room: Room = {
      id: '44444444-4444-4444-8444-444444444444',
      code: 'AB12CD34',
      name: 'Sprint 42',
      deckType: 'fibonacci',
      hostId: null,
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
      lastActiveAt: new Date('2026-09-14T11:00:00.000Z'),
    };

    expect(toRoomDto(room)).toEqual({
      id: room.id,
      code: 'AB12CD34',
      name: 'Sprint 42',
      deckType: 'fibonacci',
      hostId: null,
      createdAt: '2026-09-14T10:00:00.000Z',
    });
  });
});
