import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';
import {
  findRoomById,
  listParticipants,
  listRounds,
  listVotesForRound,
  type Room,
  type VotingRound,
} from '../../src/db/repositories/index.js';
import { startRoomCleanupJob, sweepIdleRooms } from '../../src/jobs/room-cleanup.js';
import { seedRoomWithRound, seedUser, truncateAll } from '../helpers/seed.js';

/**
 * The idle-room sweep (PRD §3.1.9 / FR-10) against the real database.
 *
 * The point of doing this here rather than only in unit tests is the cascade: whether
 * `room_participants`, `voting_rounds` and `votes` really go with the room is a property of
 * migration 0002's foreign keys, not of any TypeScript we could mock. The other property worth
 * proving against real SQL is the negative one — that `users` survives a sweep that deletes a
 * room they hosted and sat in, because PRD §7 makes accounts permanent.
 */

const IDLE_HOURS = 24;

describe('idle room cleanup against Postgres', () => {
  let db: pg.Pool;

  beforeAll(async () => {
    db = getPool();
    await runMigrations();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  /** Rewinds a room's clock, which is the only thing that makes it a candidate for the sweep. */
  async function setLastActive(room: Room, hoursAgo: number): Promise<void> {
    await db.query(
      `UPDATE rooms SET last_active_at = now() - ($2 || ' hours')::interval WHERE id = $1`,
      [room.id, String(hoursAgo)],
    );
  }

  async function sweep(): Promise<string[]> {
    const result = await sweepIdleRooms(db, {
      idleHours: IDLE_HOURS,
      logger: { info: () => {}, error: () => {} },
    });
    return result.deleted.map((room) => room.code);
  }

  async function countChildren(room: Room, round: VotingRound): Promise<number> {
    const participants = await listParticipants(db, room.id);
    const rounds = await listRounds(db, room.id);
    const votes = await listVotesForRound(db, round.id);
    return participants.length + rounds.length + votes.length;
  }

  it('deletes a stale room together with its participants, rounds and votes', async () => {
    const { room, round } = await seedRoomWithRound(db, { guestCount: 3, votes: ['3', '5', '5'] });
    expect(await countChildren(room, round)).toBe(3 + 1 + 3);
    await setLastActive(room, 25);

    await expect(sweep()).resolves.toEqual([room.code]);

    await expect(findRoomById(db, room.id)).resolves.toBeNull();
    expect(await countChildren(room, round)).toBe(0);
    // Belt and braces: the cascade is asserted on the tables themselves, not only through the
    // repositories, so a repository that started filtering by room would not hide a leak.
    for (const table of ['room_participants', 'voting_rounds', 'votes']) {
      const { rows } = await db.query<{ count: string }>(`SELECT count(*)::text FROM ${table}`);
      expect(rows[0]?.count, `${table} should be empty`).toBe('0');
    }
  });

  it('leaves a room with recent activity untouched', async () => {
    const { room, round } = await seedRoomWithRound(db, { guestCount: 2, votes: ['8'] });
    await setLastActive(room, 23);

    await expect(sweep()).resolves.toEqual([]);

    await expect(findRoomById(db, room.id)).resolves.not.toBeNull();
    expect(await countChildren(room, round)).toBe(2 + 1 + 1);
  });

  it('sweeps only the stale rooms when both kinds are present', async () => {
    const stale = await seedRoomWithRound(db, { guestCount: 1 });
    const fresh = await seedRoomWithRound(db, { guestCount: 1 });
    await setLastActive(stale.room, 48);

    await expect(sweep()).resolves.toEqual([stale.room.code]);

    await expect(findRoomById(db, stale.room.id)).resolves.toBeNull();
    await expect(findRoomById(db, fresh.room.id)).resolves.not.toBeNull();
  });

  it('spares a room that became active again before the sweep ran', async () => {
    const { room } = await seedRoomWithRound(db, { guestCount: 1 });
    await setLastActive(room, 30);

    // A real join over the REST route, not a hand-written UPDATE: the assertion is that the
    // production path bumps `last_active_at`, which is what rescues the room.
    await request(createApp())
      .post(`/rooms/${room.code}/join`)
      .send({ displayName: 'Late arrival' })
      .expect(200);

    await expect(sweep()).resolves.toEqual([]);
    await expect(findRoomById(db, room.id)).resolves.not.toBeNull();
  });

  it('never deletes a user, account or session row', async () => {
    const host = await seedUser(db);
    const { room } = await seedRoomWithRound(db, { guestCount: 1, hostId: host.id });
    await db.query(
      `INSERT INTO accounts ("userId", type, provider, "providerAccountId")
       VALUES ($1, 'oauth', 'google', 'google-123')`,
      [host.id],
    );
    await db.query(
      `INSERT INTO sessions ("userId", expires, "sessionToken")
       VALUES ($1, now() + interval '1 day', 'session-token-1')`,
      [host.id],
    );
    await setLastActive(room, 72);

    await expect(sweep()).resolves.toEqual([room.code]);

    for (const table of ['users', 'accounts', 'sessions']) {
      const { rows } = await db.query<{ count: string }>(`SELECT count(*)::text FROM ${table}`);
      expect(rows[0]?.count, `${table} must survive the sweep`).toBe('1');
    }
  });

  it('runs on its interval once started, and stops when told to', async () => {
    const { room } = await seedRoomWithRound(db, { guestCount: 1 });
    await setLastActive(room, 25);

    const job = startRoomCleanupJob(db, {
      intervalMs: 20,
      idleHours: IDLE_HOURS,
      logger: { info: () => {}, error: () => {} },
    });
    try {
      await expect
        .poll(async () => (await findRoomById(db, room.id)) === null, { timeout: 5_000 })
        .toBe(true);
    } finally {
      job.stop();
    }
  });
});
