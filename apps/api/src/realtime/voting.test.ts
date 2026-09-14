import { VOTE_ERROR_CODES } from '@planning-poker/shared';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { Participant, Queryable } from '../db/repositories/index.js';
import { ValidationError } from '../db/repositories/index.js';
import {
  ackFor,
  ackOk,
  readVoteRequest,
  requireHost,
  requireOpenRound,
  VoteActionError,
} from './voting.js';

/**
 * The decisions each voting action makes before it touches anything, with a canned database.
 * The behaviour against real Postgres and real sockets is `tests/integration/voting.test.ts`;
 * what is worth isolating here is the refusals, because every one of them is a rule from the
 * PRD rather than an implementation detail.
 */

/** Replays canned result sets in order, so a repository's SQL runs without a database. */
class FakeDb implements Queryable {
  constructor(private readonly responses: Array<{ rows: unknown[] }>) {}

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(): Promise<pg.QueryResult<R>> {
    const next = this.responses.shift() ?? { rows: [] };
    return Promise.resolve({
      rows: next.rows as R[],
      rowCount: next.rows.length,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
  }
}

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const HOST_SEAT = '22222222-2222-4222-8222-222222222222';
const GUEST_SEAT = '33333333-3333-4333-8333-333333333333';

function roomRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    code: 'AB12CD34',
    name: 'Sprint 42',
    deck_type: 'fibonacci',
    host_id: null,
    host_participant_id: HOST_SEAT,
    created_at: new Date('2026-09-15T00:00:00.000Z'),
    last_active_at: new Date('2026-09-15T00:00:00.000Z'),
    ...overrides,
  };
}

function roundRow(status: 'voting' | 'revealed') {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    room_id: ROOM_ID,
    round_number: 1,
    status,
    created_at: new Date('2026-09-15T00:00:00.000Z'),
    revealed_at: status === 'revealed' ? new Date('2026-09-15T00:01:00.000Z') : null,
  };
}

function seat(id: string, userId: string | null = null): Participant {
  return {
    id,
    roomId: ROOM_ID,
    userId,
    guestName: 'Someone',
    joinedAt: new Date('2026-09-15T00:00:00.000Z'),
    isOnline: true,
  };
}

describe('readVoteRequest', () => {
  it('takes the card out of a well-formed payload', () => {
    expect(readVoteRequest({ value: '8' })).toBe('8');
  });

  it.each([undefined, null, {}, { value: 5 }, { value: '' }, 'XL'])(
    'refuses the malformed payload %j as an invalid card',
    (payload) => {
      expect(() => readVoteRequest(payload)).toThrow(VoteActionError);
      expect(() => readVoteRequest(payload)).toThrow(/value is required/);
    },
  );

  it('does not judge the card itself — that is the deck check in the data layer', () => {
    // Off-deck values are rejected by `assertValidVoteValue`, which knows the room's deck.
    expect(readVoteRequest({ value: 'not-a-card' })).toBe('not-a-card');
  });
});

describe('requireOpenRound', () => {
  it('returns the round while it is still being voted on', async () => {
    const db = new FakeDb([{ rows: [roundRow('voting')] }]);

    await expect(requireOpenRound(db, ROOM_ID)).resolves.toMatchObject({ status: 'voting' });
  });

  it('refuses a vote into a revealed round (FR-4: votes are final once the cards are up)', async () => {
    const db = new FakeDb([{ rows: [roundRow('revealed')] }]);

    await expect(requireOpenRound(db, ROOM_ID)).rejects.toMatchObject({
      code: VOTE_ERROR_CODES.ROUND_NOT_OPEN,
    });
  });
});

describe('requireHost', () => {
  it('lets the guest host of a guest-created room through', async () => {
    const db = new FakeDb([{ rows: [roomRow()] }]);

    await expect(requireHost(db, ROOM_ID, seat(HOST_SEAT))).resolves.toMatchObject({ id: ROOM_ID });
  });

  it('refuses a non-host participant', async () => {
    const db = new FakeDb([{ rows: [roomRow()] }]);

    await expect(requireHost(db, ROOM_ID, seat(GUEST_SEAT))).rejects.toMatchObject({
      code: VOTE_ERROR_CODES.NOT_HOST,
    });
  });

  it('reads the room again rather than trusting the handshake snapshot', async () => {
    // The seat that hosted the room at connect time is not the host any more.
    const db = new FakeDb([{ rows: [roomRow({ host_participant_id: GUEST_SEAT })] }]);

    await expect(requireHost(db, ROOM_ID, seat(HOST_SEAT))).rejects.toMatchObject({
      code: VOTE_ERROR_CODES.NOT_HOST,
    });
  });

  it('refuses everybody once the room is gone', async () => {
    const db = new FakeDb([{ rows: [] }]);

    await expect(requireHost(db, ROOM_ID, seat(HOST_SEAT))).rejects.toMatchObject({
      code: VOTE_ERROR_CODES.NO_ROUND,
    });
  });
});

describe('acknowledgements', () => {
  it('reports success', () => {
    expect(ackOk()).toEqual({ ok: true });
  });

  it('passes a refusal through with its code', () => {
    expect(ackFor(new VoteActionError(VOTE_ERROR_CODES.NOT_HOST, 'nope'))).toEqual({
      ok: false,
      code: VOTE_ERROR_CODES.NOT_HOST,
      message: 'nope',
    });
  });

  it('turns an off-deck card from the data layer into invalid_card', () => {
    expect(ackFor(new ValidationError('"XL" is not a card in the fibonacci deck'))).toMatchObject({
      ok: false,
      code: VOTE_ERROR_CODES.INVALID_CARD,
    });
  });

  it('does not leak an unexpected failure to the client', () => {
    expect(ackFor(new Error('connection terminated: password=hunter2'))).toEqual({
      ok: false,
      code: VOTE_ERROR_CODES.INTERNAL,
      message: 'không thực hiện được thao tác này',
    });
  });
});
