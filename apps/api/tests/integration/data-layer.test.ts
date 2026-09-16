import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';
import {
  addParticipant,
  castVote,
  ConflictError,
  createRoom,
  createRound,
  createUser,
  deleteRoomsIdleBefore,
  deleteVote,
  ensureCurrentRound,
  findCurrentRound,
  findParticipantById,
  findRoomByCode,
  findRoomById,
  findRoundById,
  listParticipants,
  listRounds,
  listVoterIds,
  listVotesForRound,
  removeParticipant,
  revealRound,
  setParticipantOnline,
  touchRoom,
  ValidationError,
} from '../../src/db/repositories/index.js';
import { withTransaction } from '../../src/db/transaction.js';
import { seedGuest, seedRoom, seedRoomWithRound, seedUser, truncateAll } from '../helpers/seed.js';

/**
 * Exercises every data-access function against the docker-compose Postgres, and checks that
 * the constraints in 0002 genuinely reject bad data rather than merely being declared.
 */
describe('data layer against Postgres', () => {
  // Resolved in beforeAll, not at collection time: the other integration file closes the pool
  // in its own afterAll, and getPool() must be called after that to hand back a live one.
  let db: pg.Pool;

  beforeAll(async () => {
    db = getPool();
    await runMigrations();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await truncateAll(db);
    await closePool();
  });

  describe('migrations', () => {
    it('creates every table the data model needs', async () => {
      const { rows } = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`,
      );
      const tables = rows.map((row) => row.table_name);

      expect(tables).toEqual(
        expect.arrayContaining([
          'accounts',
          'room_participants',
          'rooms',
          'sessions',
          'users',
          'verification_token',
          'votes',
          'voting_rounds',
        ]),
      );
    });

    it('is idempotent when re-run', async () => {
      await expect(runMigrations()).resolves.toEqual([]);
    });

    it('records 0002 in the ledger', async () => {
      const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');

      expect(rows.map((r) => r.name)).toContain('0002_planning_poker_schema.sql');
    });

    it('gives users the NextAuth adapter column names, id defaulted by the database', async () => {
      const { rows } = await db.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'`,
      );
      const byName = new Map(rows.map((r) => [r.column_name, r.data_type]));

      // The adapter's createUser inserts exactly these four and reads the id back.
      expect([...byName.keys()].sort()).toEqual(
        ['created_at', 'email', 'emailVerified', 'id', 'image', 'name'].sort(),
      );
      expect(byName.get('id')).toBe('uuid');

      const { rows: inserted } = await db.query<{ id: string }>(
        `INSERT INTO users (name, email, "emailVerified", image) VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, "emailVerified", image`,
        ['Adapter User', 'adapter@example.test', null, null],
      );
      expect(inserted[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('rooms', () => {
    it('creates a room and finds it by code', async () => {
      const created = await createRoom(db, { name: 'Sprint 42', deckType: 'fibonacci' });

      const found = await findRoomByCode(db, created.code);

      expect(found).toEqual(created);
      expect(created.hostId).toBeNull();
      expect(created.code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    });

    it('finds a room by a code typed in lower case with whitespace', async () => {
      const created = await seedRoom(db, { code: 'AB12CD34' });

      await expect(findRoomByCode(db, '  ab12cd34 ')).resolves.toMatchObject({ id: created.id });
    });

    it('records a signed-in host', async () => {
      const host = await seedUser(db);

      const room = await createRoom(db, { name: 'Sprint 42', deckType: 'tshirt', hostId: host.id });

      expect(room.hostId).toBe(host.id);
      expect(room.deckType).toBe('tshirt');
    });

    it('returns null for an unknown code', async () => {
      await expect(findRoomByCode(db, 'ZZZZZZZZ')).resolves.toBeNull();
    });

    it('rejects a duplicate room code', async () => {
      await seedRoom(db, { code: 'AB12CD34' });

      await expect(seedRoom(db, { code: 'AB12CD34' })).rejects.toThrow(ConflictError);
    });

    it('rejects a deck type outside the enum', async () => {
      await expect(
        db.query(`INSERT INTO rooms (code, name, deck_type) VALUES ('ZZ99ZZ99', 'x', 'tarot')`),
      ).rejects.toThrow(/rooms_deck_type_check/);
    });

    it('rejects a blank room name at the database level', async () => {
      await expect(
        db.query(
          `INSERT INTO rooms (code, name, deck_type) VALUES ('ZZ99ZZ98', '   ', 'fibonacci')`,
        ),
      ).rejects.toThrow(/rooms_name_check/);
    });

    it('rejects a host_id that is not a real user', async () => {
      await expect(
        createRoom(db, {
          name: 'Sprint 42',
          deckType: 'fibonacci',
          hostId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(/rooms_host_id_fkey/);
    });

    it('nulls the host but keeps the room when the host account is deleted', async () => {
      const host = await seedUser(db);
      const room = await seedRoom(db, { hostId: host.id });

      await db.query('DELETE FROM users WHERE id = $1', [host.id]);

      await expect(findRoomById(db, room.id)).resolves.toMatchObject({ hostId: null });
    });

    it('bumps last_active_at when touched', async () => {
      const room = await seedRoom(db);
      await db.query(`UPDATE rooms SET last_active_at = now() - interval '2 hours' WHERE id = $1`, [
        room.id,
      ]);

      const touched = await touchRoom(db, room.id);

      expect(touched?.lastActiveAt.getTime()).toBeGreaterThan(room.createdAt.getTime() - 1000);
      expect(touched?.lastActiveAt.getTime()).toBeGreaterThan(
        new Date(Date.now() - 60_000).getTime(),
      );
    });

    it('sweeps away rooms idle past the window, keeping active ones', async () => {
      const stale = await seedRoom(db);
      const fresh = await seedRoom(db);
      await db.query(
        `UPDATE rooms SET last_active_at = now() - interval '48 hours' WHERE id = $1`,
        [stale.id],
      );

      await expect(
        deleteRoomsIdleBefore(db, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ).resolves.toHaveLength(1);
      await expect(findRoomById(db, stale.id)).resolves.toBeNull();
      await expect(findRoomById(db, fresh.id)).resolves.not.toBeNull();
    });
  });

  describe('participants', () => {
    it('adds a guest and lists them', async () => {
      const room = await seedRoom(db);

      const guest = await addParticipant(db, { roomId: room.id, guestName: 'Khoi' });

      expect(guest).toMatchObject({
        roomId: room.id,
        userId: null,
        guestName: 'Khoi',
        isOnline: true,
      });
      await expect(listParticipants(db, room.id)).resolves.toEqual([guest]);
      await expect(findParticipantById(db, guest.id)).resolves.toEqual(guest);
    });

    it('adds a signed-in participant', async () => {
      const room = await seedRoom(db);
      const user = await seedUser(db);

      const participant = await addParticipant(db, { roomId: room.id, userId: user.id });

      expect(participant).toMatchObject({ userId: user.id, guestName: null });
    });

    it('lets two different guests share a display name', async () => {
      const room = await seedRoom(db);

      await seedGuest(db, room.id, 'Khoi');
      await seedGuest(db, room.id, 'Khoi');

      await expect(listParticipants(db, room.id)).resolves.toHaveLength(2);
    });

    it('reuses the seat when a signed-in user rejoins, instead of seating them twice', async () => {
      const room = await seedRoom(db);
      const user = await seedUser(db);
      const first = await addParticipant(db, { roomId: room.id, userId: user.id });
      await setParticipantOnline(db, first.id, false);

      const second = await addParticipant(db, {
        roomId: room.id,
        userId: user.id,
        guestName: 'PO',
      });

      expect(second.id).toBe(first.id);
      expect(second.isOnline).toBe(true);
      expect(second.guestName).toBe('PO');
      await expect(listParticipants(db, room.id)).resolves.toHaveLength(1);
    });

    it('keeps a rejoining user in one seat across two rooms', async () => {
      const [roomA, roomB] = [await seedRoom(db), await seedRoom(db)];
      const user = await seedUser(db);

      await addParticipant(db, { roomId: roomA.id, userId: user.id });
      await addParticipant(db, { roomId: roomB.id, userId: user.id });

      await expect(listParticipants(db, roomA.id)).resolves.toHaveLength(1);
      await expect(listParticipants(db, roomB.id)).resolves.toHaveLength(1);
    });

    it('rejects a participant who is neither a user nor a named guest', async () => {
      const room = await seedRoom(db);

      await expect(addParticipant(db, { roomId: room.id })).rejects.toThrow(ValidationError);
      await expect(
        db.query('INSERT INTO room_participants (room_id) VALUES ($1)', [room.id]),
      ).rejects.toThrow(/room_participants_identity_present/);
    });

    it('rejects a participant in a room that does not exist', async () => {
      await expect(
        addParticipant(db, {
          roomId: '00000000-0000-0000-0000-000000000000',
          guestName: 'Nobody',
        }),
      ).rejects.toThrow(/room_participants_room_id_fkey/);
    });

    it('toggles the online flag without losing the seat', async () => {
      const { participants, round } = await seedRoomWithRound(db, { guestCount: 1, votes: ['5'] });
      const participant = participants[0]!;

      await expect(setParticipantOnline(db, participant.id, false)).resolves.toMatchObject({
        isOnline: false,
      });
      await expect(listVotesForRound(db, round.id)).resolves.toHaveLength(1);
    });

    it('removes a participant and cascades their votes away', async () => {
      const { participants, round } = await seedRoomWithRound(db, {
        guestCount: 2,
        votes: ['3', '5'],
      });
      const leaving = participants[0]!;

      await expect(removeParticipant(db, leaving.id)).resolves.toBe(true);

      await expect(findParticipantById(db, leaving.id)).resolves.toBeNull();
      const remaining = await listVotesForRound(db, round.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.participantId).toBe(participants[1]?.id);
    });

    it('reports nothing removed for an unknown participant', async () => {
      await expect(removeParticipant(db, '00000000-0000-0000-0000-000000000000')).resolves.toBe(
        false,
      );
    });

    it('cascades participants away when the room is deleted', async () => {
      const room = await seedRoom(db);
      await seedGuest(db, room.id);

      await db.query('DELETE FROM rooms WHERE id = $1', [room.id]);

      await expect(listParticipants(db, room.id)).resolves.toEqual([]);
    });
  });

  describe('voting rounds', () => {
    it('numbers rounds from one, upwards, per room', async () => {
      const roomA = await seedRoom(db);
      const roomB = await seedRoom(db);

      const first = await createRound(db, roomA.id);
      const second = await createRound(db, roomA.id);
      const otherRoom = await createRound(db, roomB.id);

      expect(first.roundNumber).toBe(1);
      expect(second.roundNumber).toBe(2);
      expect(otherRoom.roundNumber).toBe(1);
    });

    it('opens a round in the voting state with no reveal timestamp', async () => {
      const room = await seedRoom(db);

      const round = await createRound(db, room.id);

      expect(round).toMatchObject({ status: 'voting', revealedAt: null });
      await expect(findRoundById(db, round.id)).resolves.toEqual(round);
    });

    it('returns the newest round as the current one', async () => {
      const room = await seedRoom(db);
      await createRound(db, room.id);
      const latest = await createRound(db, room.id);

      await expect(findCurrentRound(db, room.id)).resolves.toEqual(latest);
      await expect(listRounds(db, room.id)).resolves.toHaveLength(2);
    });

    it('returns null when a room has no rounds yet', async () => {
      const room = await seedRoom(db);

      await expect(findCurrentRound(db, room.id)).resolves.toBeNull();
    });

    it('reveals a round, stamping revealed_at', async () => {
      const { round } = await seedRoomWithRound(db);

      const revealed = await revealRound(db, round.id);

      expect(revealed?.status).toBe('revealed');
      expect(revealed?.revealedAt).toBeInstanceOf(Date);
    });

    it('ignores a second reveal so the timestamp cannot move', async () => {
      const { round } = await seedRoomWithRound(db);
      const first = await revealRound(db, round.id);

      await expect(revealRound(db, round.id)).resolves.toBeNull();
      await expect(findRoundById(db, round.id)).resolves.toEqual(first);
    });

    it('rejects a revealed round with no revealed_at', async () => {
      const room = await seedRoom(db);

      await expect(
        db.query(
          `INSERT INTO voting_rounds (room_id, round_number, status) VALUES ($1, 1, 'revealed')`,
          [room.id],
        ),
      ).rejects.toThrow(/voting_rounds_revealed_at_matches_status/);
    });

    it('rejects a duplicate round number in the same room', async () => {
      const room = await seedRoom(db);
      await createRound(db, room.id);

      await expect(
        db.query('INSERT INTO voting_rounds (room_id, round_number) VALUES ($1, 1)', [room.id]),
      ).rejects.toThrow(/voting_rounds_room_round_number_key/);
    });

    it('rejects a round in a room that does not exist', async () => {
      await expect(createRound(db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        /voting_rounds_room_id_fkey/,
      );
    });

    it('lets two callers race the first round open, one of them inside its own transaction', async () => {
      const room = await seedRoom(db);

      // Mirrors handleVoteCast: one caller runs ensureCurrentRound on a transaction client, the
      // other on the bare pool, both finding no round yet and racing to insert round 1. Neither
      // may throw — a caller inside a transaction that hit a raw unique-violation here would have
      // its whole transaction aborted, poisoning the very re-read meant to recover from the race.
      const [fromTransaction, standalone] = await Promise.all([
        withTransaction(db, (client) => ensureCurrentRound(client, room.id)),
        ensureCurrentRound(db, room.id),
      ]);

      expect(fromTransaction.id).toBe(standalone.id);
      expect(fromTransaction.roundNumber).toBe(1);
      await expect(listRounds(db, room.id)).resolves.toHaveLength(1);
    });
  });

  describe('votes', () => {
    it('casts votes and lists them for the round', async () => {
      const { round, participants } = await seedRoomWithRound(db, {
        guestCount: 3,
        votes: ['3', '5', '8'],
      });

      const votes = await listVotesForRound(db, round.id);

      expect(votes.map((v) => v.value)).toEqual(['3', '5', '8']);
      expect(votes.map((v) => v.participantId)).toEqual(participants.map((p) => p.id));
    });

    it('replaces a vote instead of adding a second one', async () => {
      const { round, participants } = await seedRoomWithRound(db, { guestCount: 1, votes: ['3'] });
      const participant = participants[0]!;

      const changed = await castVote(db, {
        roundId: round.id,
        participantId: participant.id,
        deckType: 'fibonacci',
        value: '13',
      });

      const votes = await listVotesForRound(db, round.id);
      expect(votes).toHaveLength(1);
      expect(votes[0]?.value).toBe('13');
      expect(changed.id).toBe(votes[0]?.id);
    });

    it('accepts the special cards', async () => {
      const { round } = await seedRoomWithRound(db, {
        guestCount: 2,
        votes: ['?', '☕'],
      });

      await expect(listVotesForRound(db, round.id)).resolves.toMatchObject([
        { value: '?' },
        { value: '☕' },
      ]);
    });

    it('accepts t-shirt cards in a t-shirt room', async () => {
      const { round } = await seedRoomWithRound(db, {
        guestCount: 2,
        deckType: 'tshirt',
        votes: ['M', 'XL'],
      });

      await expect(listVotesForRound(db, round.id)).resolves.toHaveLength(2);
    });

    it('rejects a card that is not in the room deck', async () => {
      const { round, participants } = await seedRoomWithRound(db, { guestCount: 1 });

      await expect(
        castVote(db, {
          roundId: round.id,
          participantId: participants[0]!.id,
          deckType: 'fibonacci',
          value: 'XL',
        }),
      ).rejects.toThrow(ValidationError);
      await expect(listVotesForRound(db, round.id)).resolves.toEqual([]);
    });

    it('rejects a vote referencing a round that does not exist', async () => {
      const { participants } = await seedRoomWithRound(db, { guestCount: 1 });

      await expect(
        castVote(db, {
          roundId: '00000000-0000-0000-0000-000000000000',
          participantId: participants[0]!.id,
          deckType: 'fibonacci',
          value: '5',
        }),
      ).rejects.toThrow(/votes_round_id_fkey/);
    });

    it('rejects a vote from a participant that does not exist', async () => {
      const { round } = await seedRoomWithRound(db, { guestCount: 1 });

      await expect(
        castVote(db, {
          roundId: round.id,
          participantId: '00000000-0000-0000-0000-000000000000',
          deckType: 'fibonacci',
          value: '5',
        }),
      ).rejects.toThrow(/votes_participant_id_fkey/);
    });

    it('lists only who has voted, for the pre-reveal broadcast', async () => {
      const { round, participants } = await seedRoomWithRound(db, {
        guestCount: 3,
        votes: ['3', '5'],
      });

      const voterIds = await listVoterIds(db, round.id);

      expect(voterIds).toHaveLength(2);
      expect(voterIds).not.toContain(participants[2]?.id);
    });

    it('deletes a single vote', async () => {
      const { round, participants } = await seedRoomWithRound(db, {
        guestCount: 2,
        votes: ['3', '5'],
      });

      await expect(deleteVote(db, round.id, participants[0]!.id)).resolves.toBe(true);
      await expect(deleteVote(db, round.id, participants[0]!.id)).resolves.toBe(false);
      await expect(listVotesForRound(db, round.id)).resolves.toHaveLength(1);
    });

    it('cascades votes away with their round', async () => {
      const { round } = await seedRoomWithRound(db, { guestCount: 2, votes: ['3', '5'] });

      await db.query('DELETE FROM voting_rounds WHERE id = $1', [round.id]);

      await expect(listVotesForRound(db, round.id)).resolves.toEqual([]);
    });

    it('cascades votes away when the whole room goes', async () => {
      const { room, round } = await seedRoomWithRound(db, { guestCount: 2, votes: ['3', '5'] });

      await db.query('DELETE FROM rooms WHERE id = $1', [room.id]);

      await expect(listVotesForRound(db, round.id)).resolves.toEqual([]);
    });
  });

  describe('users', () => {
    it('creates a user with the display name mapped onto the adapter column', async () => {
      const user = await createUser(db, { email: 'khoi@example.test', displayName: 'Khoi' });

      expect(user).toMatchObject({ email: 'khoi@example.test', displayName: 'Khoi' });
      const { rows } = await db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [
        user.id,
      ]);
      expect(rows[0]?.name).toBe('Khoi');
    });

    it('rejects a duplicate email', async () => {
      await createUser(db, { email: 'dup@example.test' });

      await expect(createUser(db, { email: 'dup@example.test' })).rejects.toThrow(
        /users_email_key/,
      );
    });

    it('allows several users with no email, as the adapter requires', async () => {
      await createUser(db, {});
      await createUser(db, {});

      const { rows } = await db.query<{ count: string }>('SELECT count(*) FROM users');
      expect(rows[0]?.count).toBe('2');
    });

    it('rejects an obviously malformed email before querying', async () => {
      await expect(createUser(db, { email: 'not-an-email' })).rejects.toThrow(ValidationError);
    });
  });
});
