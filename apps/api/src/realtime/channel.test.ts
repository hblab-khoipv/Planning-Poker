import { SOCKET_EVENTS } from '@planning-poker/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  emitParticipantJoined,
  emitParticipantLeft,
  emitVoteCast,
  type RealtimeServer,
  roomChannel,
  voteCastPayload,
} from './channel.js';

/**
 * Scoping and payloads. The scoping tests matter because a broadcast addressed to the wrong
 * channel is a room leaking into another room; the `vote:cast` test is FR-4's guarantee written
 * down — the event that says somebody voted may not say what they voted.
 */

function fakeServer() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { io: { to } as unknown as RealtimeServer, to, emit };
}

const PARTICIPANT = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Lan',
  isGuest: true,
  isHost: false,
  isOnline: true,
  joinedAt: '2026-09-15T00:00:00.000Z',
};

describe('roomChannel', () => {
  it('namespaces the channel so it cannot collide with a socket id room', () => {
    expect(roomChannel('ABCD2345')).toBe('room:ABCD2345');
  });

  it('gives two rooms two channels', () => {
    expect(roomChannel('ABCD2345')).not.toBe(roomChannel('ZZ99ZZ99'));
  });
});

describe('room broadcasts', () => {
  it('sends participant:joined only to the room it happened in', () => {
    const { io, to, emit } = fakeServer();
    emitParticipantJoined(io, 'ABCD2345', PARTICIPANT);

    expect(to).toHaveBeenCalledWith('room:ABCD2345');
    expect(emit).toHaveBeenCalledWith(SOCKET_EVENTS.PARTICIPANT_JOINED, {
      participant: PARTICIPANT,
    });
  });

  it('sends participant:left with the id and nothing else (PRD §8)', () => {
    const { io, to, emit } = fakeServer();
    emitParticipantLeft(io, 'ABCD2345', PARTICIPANT.id);

    expect(to).toHaveBeenCalledWith('room:ABCD2345');
    expect(emit).toHaveBeenCalledWith(SOCKET_EVENTS.PARTICIPANT_LEFT, {
      participantId: PARTICIPANT.id,
    });
  });
});

describe('vote:cast', () => {
  it('carries who voted and that they voted — never the value (FR-4)', () => {
    const payload = voteCastPayload(PARTICIPANT.id);

    expect(payload).toEqual({ participantId: PARTICIPANT.id, hasVoted: true });
    expect(Object.keys(payload).sort()).toEqual(['hasVoted', 'participantId']);
  });

  it('broadcasts that shape to the room', () => {
    const { io, to, emit } = fakeServer();
    emitVoteCast(io, 'ABCD2345', PARTICIPANT.id);

    expect(to).toHaveBeenCalledWith('room:ABCD2345');
    expect(emit).toHaveBeenCalledWith(SOCKET_EVENTS.VOTE_CAST, {
      participantId: PARTICIPANT.id,
      hasVoted: true,
    });
  });
});
