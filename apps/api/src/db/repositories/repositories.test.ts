import { describe, expect, it } from 'vitest';
import { assertParticipantIdentity, GUEST_NAME_MAX_LENGTH } from './participants.js';
import {
  assertValidRoomName,
  createRoom,
  deleteRoomsIdleBefore,
  findRoomByCode,
  ROOM_NAME_MAX_LENGTH,
} from './rooms.js';
import { assertValidVoteValue, castVote } from './votes.js';
import { ConflictError, isUniqueViolation, type Queryable, ValidationError } from './types.js';

/**
 * An in-memory stand-in for a pg client. It records what SQL the repositories build and
 * replays canned results, so the query-building and validation logic can be exercised without
 * a database. Real SQL behaviour is covered by tests/integration/data-layer.test.ts.
 */
class FakeDb implements Queryable {
  readonly calls: Array<{ text: string; values: unknown[] }> = [];

  constructor(private readonly responses: Array<{ rows: unknown[]; rowCount?: number } | Error>) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query(text: string, values: unknown[] = []): Promise<any> {
    this.calls.push({ text, values });
    const next = this.responses.shift() ?? { rows: [] };
    if (next instanceof Error) throw next;
    return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length };
  }

  get lastCall(): { text: string; values: unknown[] } {
    const call = this.calls.at(-1);
    if (!call) throw new Error('no query was issued');
    return call;
  }
}

function uniqueViolation(constraint: string): Error & { code: string; constraint: string } {
  return Object.assign(new Error('duplicate key value'), {
    code: '23505',
    constraint,
  });
}

const ROOM_ROW = {
  id: 'room-1',
  code: 'AB12CD34',
  name: 'Sprint 42',
  deck_type: 'fibonacci',
  host_id: null,
  created_at: new Date('2026-09-14T00:00:00Z'),
  last_active_at: new Date('2026-09-14T00:00:00Z'),
};

describe('assertValidRoomName', () => {
  it('trims the stored name', () => {
    expect(assertValidRoomName('  Sprint 42  ')).toBe('Sprint 42');
  });

  it.each(['', '   ', '\t\n'])('rejects the blank name %j', (name) => {
    expect(() => assertValidRoomName(name)).toThrow(ValidationError);
  });

  it('accepts a name exactly at the limit', () => {
    const name = 'x'.repeat(ROOM_NAME_MAX_LENGTH);

    expect(assertValidRoomName(name)).toBe(name);
  });

  it('rejects a name one character over the limit', () => {
    expect(() => assertValidRoomName('x'.repeat(ROOM_NAME_MAX_LENGTH + 1))).toThrow(
      /at most 80 characters/,
    );
  });
});

describe('createRoom', () => {
  it('inserts the trimmed name, deck and host', async () => {
    const db = new FakeDb([{ rows: [ROOM_ROW] }]);

    const room = await createRoom(db, {
      name: '  Sprint 42  ',
      deckType: 'fibonacci',
      hostId: 'user-1',
      code: 'AB12CD34',
    });

    expect(db.lastCall.text).toContain('INSERT INTO rooms');
    expect(db.lastCall.values).toEqual(['AB12CD34', 'Sprint 42', 'fibonacci', 'user-1']);
    expect(room).toMatchObject({ id: 'room-1', code: 'AB12CD34', deckType: 'fibonacci' });
  });

  it('generates a code when none is supplied', async () => {
    const db = new FakeDb([{ rows: [ROOM_ROW] }]);

    await createRoom(db, { name: 'Sprint 42', deckType: 'tshirt' });

    expect(db.lastCall.values[0]).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  });

  it('stores a NULL host when a guest creates the room', async () => {
    const db = new FakeDb([{ rows: [ROOM_ROW] }]);

    await createRoom(db, { name: 'Sprint 42', deckType: 'fibonacci' });

    expect(db.lastCall.values[3]).toBeNull();
  });

  it('retries with a fresh code when the generated one collides', async () => {
    const db = new FakeDb([uniqueViolation('rooms_code_key'), { rows: [ROOM_ROW] }]);

    const room = await createRoom(db, { name: 'Sprint 42', deckType: 'fibonacci' });

    expect(db.calls).toHaveLength(2);
    expect(db.calls[0]?.values[0]).not.toBe(db.calls[1]?.values[0]);
    expect(room.id).toBe('room-1');
  });

  it('gives up as a ConflictError after exhausting its retries', async () => {
    const db = new FakeDb(Array.from({ length: 5 }, () => uniqueViolation('rooms_code_key')));

    await expect(createRoom(db, { name: 'Sprint 42', deckType: 'fibonacci' })).rejects.toThrow(
      ConflictError,
    );
    expect(db.calls).toHaveLength(5);
  });

  it('does not retry an explicitly supplied code', async () => {
    const db = new FakeDb([uniqueViolation('rooms_code_key')]);

    await expect(
      createRoom(db, { name: 'Sprint 42', deckType: 'fibonacci', code: 'AB12CD34' }),
    ).rejects.toThrow(ConflictError);
    expect(db.calls).toHaveLength(1);
  });

  it('rethrows an unrelated database error instead of retrying', async () => {
    const db = new FakeDb([uniqueViolation('some_other_key')]);

    await expect(createRoom(db, { name: 'Sprint 42', deckType: 'fibonacci' })).rejects.toThrow(
      /duplicate key value/,
    );
    expect(db.calls).toHaveLength(1);
  });

  it('rejects an unknown deck before touching the database', async () => {
    const db = new FakeDb([]);

    await expect(
      // @ts-expect-error deliberately passing a deck the shared package does not define
      createRoom(db, { name: 'Sprint 42', deckType: 'tarot' }),
    ).rejects.toThrow(ValidationError);
    expect(db.calls).toHaveLength(0);
  });

  it('rejects a malformed explicit code before touching the database', async () => {
    const db = new FakeDb([]);

    await expect(
      createRoom(db, { name: 'Sprint 42', deckType: 'fibonacci', code: 'nope' }),
    ).rejects.toThrow(ValidationError);
    expect(db.calls).toHaveLength(0);
  });
});

describe('findRoomByCode', () => {
  it('normalises the code before querying', async () => {
    const db = new FakeDb([{ rows: [ROOM_ROW] }]);

    await findRoomByCode(db, '  ab12cd34 ');

    expect(db.lastCall.values).toEqual(['AB12CD34']);
  });

  it('resolves a code typed with look-alike characters', async () => {
    const db = new FakeDb([{ rows: [ROOM_ROW] }]);

    await findRoomByCode(db, 'ilou2345');

    expect(db.lastCall.values).toEqual(['110V2345']);
  });

  it('returns null without querying when the code cannot be valid', async () => {
    const db = new FakeDb([]);

    await expect(findRoomByCode(db, 'too-short')).resolves.toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('returns null when the code is well-formed but unknown', async () => {
    const db = new FakeDb([{ rows: [] }]);

    await expect(findRoomByCode(db, 'AB12CD34')).resolves.toBeNull();
  });
});

describe('deleteRoomsIdleBefore', () => {
  it('deletes by the cutoff it is given and reports the rooms that went', async () => {
    const cutoff = new Date('2026-09-14T00:00:00.000Z');
    const lastActiveAt = new Date('2026-09-10T08:30:00.000Z');
    const db = new FakeDb([
      { rows: [{ id: 'room-1', code: 'AB12CD34', last_active_at: lastActiveAt }] },
    ]);

    await expect(deleteRoomsIdleBefore(db, cutoff)).resolves.toEqual([
      { id: 'room-1', code: 'AB12CD34', lastActiveAt },
    ]);
    expect(db.lastCall.values).toEqual([cutoff]);
    // Only `rooms` may be named: everything else goes by ON DELETE CASCADE, and users/accounts/
    // sessions are permanent (PRD §7).
    expect(db.lastCall.text).toContain('DELETE FROM rooms');
    for (const table of ['users', 'accounts', 'sessions']) {
      expect(db.lastCall.text).not.toContain(table);
    }
  });

  it('reports an empty sweep as no rooms rather than as a failure', async () => {
    const db = new FakeDb([{ rows: [] }]);

    await expect(deleteRoomsIdleBefore(db, new Date())).resolves.toEqual([]);
  });

  it('rejects an invalid cutoff without touching the database', async () => {
    const db = new FakeDb([]);

    await expect(deleteRoomsIdleBefore(db, new Date(Number.NaN))).rejects.toThrow(ValidationError);
    expect(db.calls).toHaveLength(0);
  });
});

describe('assertParticipantIdentity', () => {
  it('trims a guest name', () => {
    expect(assertParticipantIdentity({ roomId: 'r', guestName: '  Khoi  ' })).toBe('Khoi');
  });

  it('allows a signed-in user with no per-room rename', () => {
    expect(assertParticipantIdentity({ roomId: 'r', userId: 'user-1' })).toBeNull();
  });

  it('allows a signed-in user who renames themselves for the room', () => {
    expect(assertParticipantIdentity({ roomId: 'r', userId: 'user-1', guestName: 'PO' })).toBe(
      'PO',
    );
  });

  it.each([undefined, null, '', '   '])('rejects a guest whose name is %j', (guestName) => {
    expect(() => assertParticipantIdentity({ roomId: 'r', guestName })).toThrow(
      /must have a display name/,
    );
  });

  it('rejects a guest name over the length limit', () => {
    expect(() =>
      assertParticipantIdentity({ roomId: 'r', guestName: 'x'.repeat(GUEST_NAME_MAX_LENGTH + 1) }),
    ).toThrow(ValidationError);
  });
});

describe('assertValidVoteValue', () => {
  it.each(['0', '1', '13', '21', '?', '☕'])('accepts the Fibonacci card %s', (value) => {
    expect(assertValidVoteValue('fibonacci', value)).toBe(value);
  });

  it.each(['XS', 'S', 'M', 'L', 'XL', '?'])('accepts the t-shirt card %s', (value) => {
    expect(assertValidVoteValue('tshirt', value)).toBe(value);
  });

  it('rejects a t-shirt card in a Fibonacci room', () => {
    expect(() => assertValidVoteValue('fibonacci', 'XL')).toThrow(
      /not a card in the fibonacci deck/,
    );
  });

  it('rejects a Fibonacci card in a t-shirt room', () => {
    expect(() => assertValidVoteValue('tshirt', '13')).toThrow(/not a card in the tshirt deck/);
  });

  it('rejects the coffee card in a t-shirt room, which does not have one', () => {
    expect(() => assertValidVoteValue('tshirt', '☕')).toThrow(ValidationError);
  });

  it.each(['', ' 1', '4', '999'])('rejects the off-deck value %j', (value) => {
    expect(() => assertValidVoteValue('fibonacci', value)).toThrow(ValidationError);
  });

  it('rejects an unknown deck', () => {
    // @ts-expect-error deliberately passing a deck the shared package does not define
    expect(() => assertValidVoteValue('tarot', '1')).toThrow(/unknown deck type/);
  });
});

describe('castVote', () => {
  const VOTE_ROW = {
    id: 'vote-1',
    round_id: 'round-1',
    participant_id: 'participant-1',
    value: '8',
    voted_at: new Date('2026-09-14T00:00:00Z'),
  };

  it('upserts onto the one-vote-per-participant key', async () => {
    const db = new FakeDb([{ rows: [VOTE_ROW] }]);

    const vote = await castVote(db, {
      roundId: 'round-1',
      participantId: 'participant-1',
      deckType: 'fibonacci',
      value: '8',
    });

    expect(db.lastCall.text).toContain('ON CONFLICT (round_id, participant_id)');
    expect(db.lastCall.text).toContain('DO UPDATE SET value = EXCLUDED.value');
    expect(db.lastCall.values).toEqual(['round-1', 'participant-1', '8']);
    expect(vote.value).toBe('8');
  });

  it('validates against the deck before issuing any SQL', async () => {
    const db = new FakeDb([]);

    await expect(
      castVote(db, {
        roundId: 'round-1',
        participantId: 'participant-1',
        deckType: 'fibonacci',
        value: 'XL',
      }),
    ).rejects.toThrow(ValidationError);
    expect(db.calls).toHaveLength(0);
  });
});

describe('isUniqueViolation', () => {
  it('recognises a unique violation by SQLSTATE', () => {
    expect(isUniqueViolation(uniqueViolation('rooms_code_key'))).toBe(true);
  });

  it('matches on the constraint name when one is given', () => {
    expect(isUniqueViolation(uniqueViolation('rooms_code_key'), 'rooms_code_key')).toBe(true);
    expect(
      isUniqueViolation(uniqueViolation('votes_round_participant_key'), 'rooms_code_key'),
    ).toBe(false);
  });

  it.each([
    ['a foreign-key violation', Object.assign(new Error('fk'), { code: '23503' })],
    ['a plain error', new Error('boom')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
  ])('returns false for %s', (_label, error) => {
    expect(isUniqueViolation(error)).toBe(false);
  });
});
