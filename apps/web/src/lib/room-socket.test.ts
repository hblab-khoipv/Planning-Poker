import { SOCKET_ERROR_CODES, type ParticipantDto } from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import {
  applyParticipantJoined,
  applyParticipantLeft,
  messageForSocketError,
} from '@/lib/room-socket';

/**
 * How the browser folds the room's event stream into the list it renders. The rules that matter
 * are both about *not* trusting the stream to be tidy: the same person can be announced twice
 * (snapshot, then a rejoin), and somebody leaving must not be deleted — their seat, and from
 * task 6 their vote, outlives their connection.
 */

function participant(overrides: Partial<ParticipantDto> = {}): ParticipantDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Lan',
    isGuest: true,
    isHost: false,
    isOnline: true,
    joinedAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

const HOST = participant({ id: '22222222-2222-4222-8222-222222222222', displayName: 'Khôi' });

describe('applyParticipantJoined', () => {
  it('appends somebody the list has not seen', () => {
    const lan = participant();
    expect(applyParticipantJoined([HOST], lan)).toEqual([HOST, lan]);
  });

  it('updates in place rather than listing the same person twice', () => {
    const lan = participant({ isOnline: false });
    const rejoined = participant({ isOnline: true });

    expect(applyParticipantJoined([HOST, lan], rejoined)).toEqual([HOST, rejoined]);
  });

  it('keeps join order when somebody is re-announced', () => {
    const lan = participant();
    const updated = participant({ displayName: 'Lan (đổi tên)' });

    expect(applyParticipantJoined([lan, HOST], updated).map((p) => p.id)).toEqual([
      lan.id,
      HOST.id,
    ]);
  });

  it('does not mutate the list it was given', () => {
    const list = [HOST];
    applyParticipantJoined(list, participant());
    expect(list).toEqual([HOST]);
  });
});

describe('applyParticipantLeft', () => {
  it('marks the seat offline instead of removing it', () => {
    const lan = participant();

    expect(applyParticipantLeft([HOST, lan], lan.id)).toEqual([HOST, { ...lan, isOnline: false }]);
  });

  it('leaves everybody else alone', () => {
    const lan = participant();
    expect(applyParticipantLeft([HOST, lan], lan.id)[0]).toEqual(HOST);
  });

  it('ignores an id that is not in the list', () => {
    const list = [HOST];
    expect(applyParticipantLeft(list, 'someone-else')).toEqual(list);
  });
});

describe('messageForSocketError', () => {
  it('tells somebody who has not joined what to do about it', () => {
    expect(messageForSocketError(new Error(SOCKET_ERROR_CODES.NOT_A_PARTICIPANT))).toContain(
      'chưa tham gia',
    );
  });

  it('tells an unknown room apart from a refused seat', () => {
    expect(messageForSocketError(new Error(SOCKET_ERROR_CODES.ROOM_NOT_FOUND))).toContain(
      'Không tìm thấy phòng',
    );
  });

  it('falls back to a reconnecting message for a transport failure', () => {
    expect(messageForSocketError(new Error('xhr poll error'))).toContain('kết nối lại');
  });
});
