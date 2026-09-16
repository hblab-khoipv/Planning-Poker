import { encode } from 'next-auth/jwt';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';
import {
  addParticipant,
  castVote,
  createRound,
  isRoomMember,
  listRoomHistoryForUser,
  revealRound,
  type Room,
  type User,
} from '../../src/db/repositories/index.js';
import { seedGuest, seedRoom, seedUser, truncateAll } from '../helpers/seed.js';

/**
 * Session history against the real database (PRD FR-9, §9.6).
 *
 * The interesting assertions here are the negative ones: what a signed-in stranger gets, what a
 * guest gets, and what a round that was never revealed gives up. Cookies are minted with
 * next-auth's own `encode`, so the authentication path under test is the real one.
 */

const NEXTAUTH_SECRET = 'integration-next-auth-secret';

describe('session history API', () => {
  let db: pg.Pool;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    vi.spyOn(config, 'nextAuthSecret', 'get').mockReturnValue(NEXTAUTH_SECRET);
    db = getPool();
    await runMigrations();
    app = createApp({ pool: db });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closePool();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  async function signedInAs(userId: string): Promise<string> {
    const token = await encode({ token: { sub: userId }, secret: NEXTAUTH_SECRET });
    return `next-auth.session-token=${token}`;
  }

  /**
   * A room the user sat in, with one round played to a reveal. Returns everything a test needs
   * to assert against without reaching back into the database.
   */
  async function playRoom(
    user: User,
    options: { name: string; votes: [string, string] },
  ): Promise<{ room: Room; memberSeatId: string; guestSeatId: string }> {
    const room = await seedRoom(db, { name: options.name, hostId: user.id });
    const seat = await addParticipant(db, { roomId: room.id, userId: user.id });
    const guest = await seedGuest(db, room.id, 'Khách');
    const round = await createRound(db, room.id);

    await castVote(db, {
      roundId: round.id,
      participantId: seat.id,
      deckType: room.deckType,
      value: options.votes[0],
    });
    await castVote(db, {
      roundId: round.id,
      participantId: guest.id,
      deckType: room.deckType,
      value: options.votes[1],
    });
    await revealRound(db, round.id);

    return { room, memberSeatId: seat.id, guestSeatId: guest.id };
  }

  describe('GET /users/me/rooms', () => {
    it('lists exactly the rooms the signed-in user took part in', async () => {
      const member = await seedUser(db);
      const stranger = await seedUser(db);

      const first = await playRoom(member, { name: 'Sprint 41', votes: ['3', '5'] });
      const second = await playRoom(member, { name: 'Sprint 42', votes: ['8', '8'] });
      // A third room the user was never in, to prove the endpoint is not "every room".
      await playRoom(stranger, { name: 'Somebody else’s room', votes: ['1', '2'] });

      const response = await request(app)
        .get('/users/me/rooms')
        .set('Cookie', await signedInAs(member.id));

      expect(response.status).toBe(200);
      expect(response.body.rooms).toHaveLength(2);
      expect(response.body.rooms.map((entry: { room: Room }) => entry.room.name).sort()).toEqual([
        'Sprint 41',
        'Sprint 42',
      ]);
      expect(JSON.stringify(response.body)).not.toContain('Somebody else');

      const summary = response.body.rooms.find(
        (entry: { room: Room }) => entry.room.code === second.room.code,
      );
      expect(summary).toMatchObject({
        participantCount: 2,
        roundCount: 1,
        revealedRoundCount: 1,
        room: { deckType: 'fibonacci', name: 'Sprint 42' },
      });
      expect(typeof summary.lastRevealedAt).toBe('string');
      expect(first.room.id).not.toBe(second.room.id);
    });

    it('orders the list by most recent activity', async () => {
      const member = await seedUser(db);
      const older = await playRoom(member, { name: 'Older', votes: ['1', '1'] });
      const newer = await playRoom(member, { name: 'Newer', votes: ['2', '2'] });

      // `last_active_at` is the activity clock every room action bumps; set it explicitly so the
      // assertion is about the ordering rather than about how fast the fixtures ran.
      await db.query(`UPDATE rooms SET last_active_at = now() - interval '2 hours' WHERE id = $1`, [
        older.room.id,
      ]);
      await db.query(`UPDATE rooms SET last_active_at = now() WHERE id = $1`, [newer.room.id]);

      const response = await request(app)
        .get('/users/me/rooms')
        .set('Cookie', await signedInAs(member.id));

      expect(response.body.rooms.map((entry: { room: Room }) => entry.room.name)).toEqual([
        'Newer',
        'Older',
      ]);
    });

    it('reports a room where nothing was ever revealed', async () => {
      const member = await seedUser(db);
      const room = await seedRoom(db, { name: 'Abandoned', hostId: member.id });
      await addParticipant(db, { roomId: room.id, userId: member.id });
      await createRound(db, room.id);

      const response = await request(app)
        .get('/users/me/rooms')
        .set('Cookie', await signedInAs(member.id));

      expect(response.body.rooms).toHaveLength(1);
      expect(response.body.rooms[0]).toMatchObject({
        roundCount: 1,
        revealedRoundCount: 0,
        lastRevealedAt: null,
      });
    });

    it('gives a signed-in user who never joined anything an empty list', async () => {
      const newcomer = await seedUser(db);
      const other = await seedUser(db);
      await playRoom(other, { name: 'Not yours', votes: ['3', '3'] });

      const response = await request(app)
        .get('/users/me/rooms')
        .set('Cookie', await signedInAs(newcomer.id));

      expect(response.status).toBe(200);
      expect(response.body.rooms).toEqual([]);
    });

    /**
     * A guest is refused rather than handed an empty list. The distinction matters: the screen
     * shows "đăng nhập để xem lịch sử" for one and "chưa có phòng nào" for the other, and a
     * guest who spent all day in rooms has history — it just was not recorded anywhere.
     */
    it('refuses a guest with 401 rather than an empty list', async () => {
      const response = await request(app).get('/users/me/rooms');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
      expect(response.body.rooms).toBeUndefined();
    });

    it('treats a tampered session cookie as a guest', async () => {
      const response = await request(app)
        .get('/users/me/rooms')
        .set('Cookie', 'next-auth.session-token=not-a-real-token');

      expect(response.status).toBe(401);
    });

    // Guest seats have a NULL user_id, so no guest can ever appear in anybody's history.
    it('never counts a guest seat as membership', async () => {
      const room = await seedRoom(db, { name: 'All guests' });
      const guest = await seedGuest(db, room.id, 'Khách');

      await expect(isRoomMember(db, room.id, guest.id)).resolves.toBe(false);
      const member = await seedUser(db);
      await expect(listRoomHistoryForUser(db, member.id)).resolves.toEqual([]);
    });
  });

  describe('GET /rooms/:code/rounds', () => {
    it('returns every round with the results the room saw at reveal time', async () => {
      const member = await seedUser(db, { displayName: 'Khôi' });
      const { room, memberSeatId, guestSeatId } = await playRoom(member, {
        name: 'Sprint 42',
        votes: ['3', '5'],
      });

      const response = await request(app)
        .get(`/rooms/${room.code}/rounds`)
        .set('Cookie', await signedInAs(member.id));

      expect(response.status).toBe(200);
      expect(response.body.room.code).toBe(room.code);
      expect(response.body.participants).toHaveLength(2);
      expect(response.body.rounds).toHaveLength(1);

      const [first] = response.body.rounds;
      expect(first.round).toMatchObject({ roundNumber: 1, status: 'revealed' });
      expect(typeof first.round.revealedAt).toBe('string');
      expect(first.votes).toEqual(
        expect.arrayContaining([
          { participantId: memberSeatId, value: '3' },
          { participantId: guestSeatId, value: '5' },
        ]),
      );
      // The same numbers task 6 computed when the host pressed "Lộ bài".
      expect(first.tally).toMatchObject({
        voteCount: 2,
        numericCount: 2,
        average: 4,
        median: 4,
        consensus: false,
      });
    });

    it('lists rounds oldest first and keeps each round’s own results', async () => {
      const member = await seedUser(db);
      const { room, memberSeatId } = await playRoom(member, {
        name: 'Many rounds',
        votes: ['1', '1'],
      });

      const second = await createRound(db, room.id);
      await castVote(db, {
        roundId: second.id,
        participantId: memberSeatId,
        deckType: room.deckType,
        value: '13',
      });
      await revealRound(db, second.id);

      const response = await request(app)
        .get(`/rooms/${room.code}/rounds`)
        .set('Cookie', await signedInAs(member.id));

      expect(
        response.body.rounds.map(
          (entry: { round: { roundNumber: number } }) => entry.round.roundNumber,
        ),
      ).toEqual([1, 2]);
      expect(response.body.rounds[0].tally).toMatchObject({ consensus: true, average: 1 });
      expect(response.body.rounds[1].tally).toMatchObject({ average: 13, voteCount: 1 });
    });

    /**
     * FR-4 does not expire. A room everybody walked away from mid-round still holds cards that
     * were never turned over, and asking for them as "history" must not be the way to see them.
     */
    it('withholds the cards of a round that was never revealed', async () => {
      const member = await seedUser(db);
      const { room, memberSeatId } = await playRoom(member, {
        name: 'Left early',
        votes: ['2', '3'],
      });

      const open = await createRound(db, room.id);
      await castVote(db, {
        roundId: open.id,
        participantId: memberSeatId,
        deckType: room.deckType,
        value: '21',
      });

      const response = await request(app)
        .get(`/rooms/${room.code}/rounds`)
        .set('Cookie', await signedInAs(member.id));

      const unrevealed = response.body.rounds[1];
      expect(unrevealed.round.status).toBe('voting');
      expect(unrevealed.votes).toEqual([]);
      expect(unrevealed.tally).toBeNull();
      // Who voted is public before a reveal; what they voted is not.
      expect(unrevealed.votedParticipantIds).toEqual([memberSeatId]);
      // Belt and braces: the value must appear nowhere in the payload. Opaque identifiers and
      // timestamps are dropped first — a uuid is hex and an ISO clock is digits, so either can
      // contain a card's digits by coincidence and fail this for the wrong reason.
      const withoutIdentifiers = JSON.stringify(unrevealed, (key, value) =>
        key === 'id' || key === 'createdAt' || key === 'revealedAt' || key === 'votedParticipantIds'
          ? undefined
          : value,
      );
      expect(withoutIdentifiers).not.toContain('21');
    });

    it('refuses a signed-in user who did not take part in the room', async () => {
      const member = await seedUser(db);
      const stranger = await seedUser(db);
      const { room } = await playRoom(member, { name: 'Private', votes: ['5', '8'] });

      const response = await request(app)
        .get(`/rooms/${room.code}/rounds`)
        .set('Cookie', await signedInAs(stranger.id));

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('forbidden');
      // Not one card value leaks in the refusal.
      expect(JSON.stringify(response.body)).not.toContain('"5"');
    });

    /**
     * Knowing the room code is what the invite link gives you, and it is deliberately not enough:
     * a guest holding the code — or a stolen seat id — gets no archive at all.
     */
    it('refuses a guest holding the room code', async () => {
      const member = await seedUser(db);
      const { room, guestSeatId } = await playRoom(member, {
        name: 'Invite only',
        votes: ['5', '8'],
      });

      const response = await request(app).get(`/rooms/${room.code}/rounds`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');

      // There is no parameter a guest could present to get in either: the endpoint reads the
      // cookie and nothing else.
      const withSeat = await request(app)
        .get(`/rooms/${room.code}/rounds`)
        .query({ participantId: guestSeatId });
      expect(withSeat.status).toBe(401);
    });

    it('404s an unknown room code before asking who is calling', async () => {
      const member = await seedUser(db);

      const response = await request(app)
        .get('/rooms/ZZZZZZZZ/rounds')
        .set('Cookie', await signedInAs(member.id));

      expect(response.status).toBe(404);
    });
  });
});
