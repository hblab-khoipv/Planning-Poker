import { encode } from 'next-auth/jwt';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';
import { findRoomByCode, listParticipants } from '../../src/db/repositories/index.js';
import { seedRoom, seedUser, truncateAll } from '../helpers/seed.js';

/**
 * The room REST API against the real database (PRD FR-1, FR-2, FR-3).
 *
 * Signed-in requests carry a cookie produced by next-auth's own `encode`, which is exactly what
 * `apps/web` puts in the browser — the authentication path under test is the real one, not a
 * stubbed-out user id.
 */

const NEXTAUTH_SECRET = 'integration-next-auth-secret';

function sessionCookie(token: string): string {
  return `next-auth.session-token=${token}`;
}

describe('room REST API', () => {
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
    return sessionCookie(await encode({ token: { sub: userId }, secret: NEXTAUTH_SECRET }));
  }

  describe('POST /rooms', () => {
    it('creates a guest-hosted room and seats the creator', async () => {
      const response = await request(app)
        .post('/rooms')
        .send({ name: '  Sprint 42 refinement  ', deckType: 'fibonacci', displayName: 'Khôi' });

      expect(response.status).toBe(201);
      expect(response.body.room).toMatchObject({
        name: 'Sprint 42 refinement',
        deckType: 'fibonacci',
        hostId: null,
      });
      // A guest creator hosts their own room (migration 0004). `hostId` stays null — there is
      // no account to point at — but `hostParticipantId` names their seat, which is what gives
      // a guest-created room somebody who may press "Lộ bài" at all (PRD §12).
      expect(response.body.room.hostParticipantId).toBe(response.body.participant.id);
      expect(response.body.participant).toMatchObject({
        displayName: 'Khôi',
        isGuest: true,
        isHost: true,
        isOnline: true,
      });

      // The code is the join link: it must be random, not derived from anything sequential.
      expect(response.body.room.code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);

      const stored = await findRoomByCode(db, response.body.room.code);
      expect(stored?.id).toBe(response.body.room.id);
      await expect(listParticipants(db, stored!.id)).resolves.toHaveLength(1);
    });

    it('makes a signed-in creator the host, using their account name', async () => {
      const user = await seedUser(db, { displayName: 'Phạm Văn Khôi' });

      const response = await request(app)
        .post('/rooms')
        .set('Cookie', await signedInAs(user.id))
        .send({ name: 'Sprint 43', deckType: 'tshirt' });

      expect(response.status).toBe(201);
      expect(response.body.room.hostId).toBe(user.id);
      expect(response.body.participant).toMatchObject({
        displayName: 'Phạm Văn Khôi',
        isGuest: false,
        isHost: true,
      });
    });

    it('gives two rooms created back to back different codes', async () => {
      const first = await request(app)
        .post('/rooms')
        .send({ name: 'A', deckType: 'fibonacci', displayName: 'Khôi' });
      const second = await request(app)
        .post('/rooms')
        .send({ name: 'B', deckType: 'fibonacci', displayName: 'Khôi' });

      expect(first.body.room.code).not.toBe(second.body.room.code);
    });

    it.each([
      ['a blank name', { name: '   ', deckType: 'fibonacci', displayName: 'Khôi' }],
      ['an unknown deck', { name: 'A', deckType: 'tarot', displayName: 'Khôi' }],
      ['a missing deck', { name: 'A', displayName: 'Khôi' }],
      ['a non-string name', { name: 42, deckType: 'fibonacci', displayName: 'Khôi' }],
      ['no display name from a guest', { name: 'A', deckType: 'fibonacci' }],
      [
        'an over-long display name',
        { name: 'A', deckType: 'fibonacci', displayName: 'x'.repeat(41) },
      ],
    ])('rejects %s with 400 and creates nothing', async (_label, body) => {
      const response = await request(app).post('/rooms').send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');

      const { rows } = await db.query('SELECT count(*)::int AS count FROM rooms');
      expect(rows[0].count).toBe(0);
    });
  });

  describe('GET /rooms/:code', () => {
    it('looks a room up by the code the browser holds', async () => {
      const room = await seedRoom(db, { name: 'Sprint 42', code: 'AB12CD34' });

      const response = await request(app).get(`/rooms/${room.code}`);

      expect(response.status).toBe(200);
      expect(response.body.room).toMatchObject({ code: 'AB12CD34', name: 'Sprint 42' });
    });

    it('resolves a code typed in lower case with look-alike characters', async () => {
      await seedRoom(db, { code: '110V2345' });

      const response = await request(app).get('/rooms/ilou2345');

      expect(response.status).toBe(200);
      expect(response.body.room.code).toBe('110V2345');
    });

    it.each([
      ['an unknown code', 'ZZ99ZZ99'],
      ['a mistyped, too-short code', 'ZZ99ZZ'],
    ])('answers 404 for %s', async (_label, code) => {
      const response = await request(app).get(`/rooms/${code}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('not_found');
    });
  });

  describe('POST /rooms/:code/join', () => {
    it('seats a guest with user_id NULL and hands back the seat id', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });

      const response = await request(app)
        .post(`/rooms/${room.code}/join`)
        .send({ displayName: '  Khôi   Phạm ' });

      expect(response.status).toBe(200);
      expect(response.body.participant).toMatchObject({
        displayName: 'Khôi Phạm',
        isGuest: true,
      });

      const seats = await listParticipants(db, room.id);
      expect(seats).toHaveLength(1);
      expect(seats[0]).toMatchObject({ id: response.body.participant.id, userId: null });
    });

    it('gives two different guests two different seats', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });

      const first = await request(app).post(`/rooms/${room.code}/join`).send({ displayName: 'A' });
      const second = await request(app).post(`/rooms/${room.code}/join`).send({ displayName: 'B' });

      expect(first.body.participant.id).not.toBe(second.body.participant.id);
      await expect(listParticipants(db, room.id)).resolves.toHaveLength(2);
    });

    it('reuses a guest seat when the browser presents the id it stored for this room', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });
      const first = await request(app)
        .post(`/rooms/${room.code}/join`)
        .send({ displayName: 'Khôi' });

      const again = await request(app)
        .post(`/rooms/${room.code}/join`)
        .send({ displayName: 'Khôi', participantId: first.body.participant.id });

      expect(again.body.participant.id).toBe(first.body.participant.id);
      await expect(listParticipants(db, room.id)).resolves.toHaveLength(1);
    });

    it('ignores a seat id belonging to another room', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });
      const elsewhere = await seedRoom(db, { code: 'ZZ99ZZ99' });
      const otherSeat = await request(app)
        .post(`/rooms/${elsewhere.code}/join`)
        .send({ displayName: 'Khôi' });

      const response = await request(app)
        .post(`/rooms/${room.code}/join`)
        .send({ displayName: 'Khôi', participantId: otherSeat.body.participant.id });

      expect(response.status).toBe(200);
      expect(response.body.participant.id).not.toBe(otherSeat.body.participant.id);
      await expect(listParticipants(db, room.id)).resolves.toHaveLength(1);
    });

    it('does not fall over on a participant id that is not even a uuid', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });

      const response = await request(app)
        .post(`/rooms/${room.code}/join`)
        .send({ displayName: 'Khôi', participantId: 'not-a-uuid' });

      expect(response.status).toBe(200);
      expect(response.body.participant.isGuest).toBe(true);
    });

    it('seats a signed-in user against their user id', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });
      const user = await seedUser(db, { displayName: 'Phạm Văn Khôi' });

      const response = await request(app)
        .post(`/rooms/${room.code}/join`)
        .set('Cookie', await signedInAs(user.id))
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.participant).toMatchObject({
        displayName: 'Phạm Văn Khôi',
        isGuest: false,
      });

      const seats = await listParticipants(db, room.id);
      expect(seats[0]?.userId).toBe(user.id);
    });

    it('reuses the same seat when a signed-in user rejoins, rather than adding a second one', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });
      const user = await seedUser(db);
      const cookie = await signedInAs(user.id);

      const first = await request(app)
        .post(`/rooms/${room.code}/join`)
        .set('Cookie', cookie)
        .send({});
      const again = await request(app)
        .post(`/rooms/${room.code}/join`)
        .set('Cookie', cookie)
        .send({});

      expect(again.body.participant.id).toBe(first.body.participant.id);
      await expect(listParticipants(db, room.id)).resolves.toHaveLength(1);
    });

    it('lets a signed-in user rename themselves for one room without a second seat', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });
      const user = await seedUser(db, { displayName: 'Phạm Văn Khôi' });
      const cookie = await signedInAs(user.id);

      await request(app).post(`/rooms/${room.code}/join`).set('Cookie', cookie).send({});
      const renamed = await request(app)
        .post(`/rooms/${room.code}/join`)
        .set('Cookie', cookie)
        .send({ displayName: 'Khôi (QA)' });

      expect(renamed.body.participant.displayName).toBe('Khôi (QA)');
      await expect(listParticipants(db, room.id)).resolves.toHaveLength(1);
    });

    it('ignores a session cookie signed with a different secret', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });
      const user = await seedUser(db);
      const forged = sessionCookie(
        await encode({ token: { sub: user.id }, secret: 'not-the-shared-secret' }),
      );

      const response = await request(app)
        .post(`/rooms/${room.code}/join`)
        .set('Cookie', forged)
        .send({ displayName: 'Kẻ giả mạo' });

      expect(response.status).toBe(200);
      expect(response.body.participant.isGuest).toBe(true);
      const seats = await listParticipants(db, room.id);
      expect(seats[0]?.userId).toBeNull();
    });

    it('refuses a join on a code no room has', async () => {
      const response = await request(app)
        .post('/rooms/ZZ99ZZ99/join')
        .send({ displayName: 'Khôi' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('not_found');
    });

    it.each([
      ['a blank display name', { displayName: '   ' }],
      ['no display name at all', {}],
      ['an over-long display name', { displayName: 'x'.repeat(41) }],
    ])('refuses a guest join with %s', async (_label, body) => {
      const room = await seedRoom(db, { code: 'AB12CD34' });

      const response = await request(app).post(`/rooms/${room.code}/join`).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
      await expect(listParticipants(db, room.id)).resolves.toHaveLength(0);
    });

    it('bumps last_active_at, which is what keeps the room off the idle sweep', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });
      await db.query("UPDATE rooms SET last_active_at = now() - interval '2 days' WHERE id = $1", [
        room.id,
      ]);

      await request(app).post(`/rooms/${room.code}/join`).send({ displayName: 'Khôi' });

      const { rows } = await db.query<{ stale: boolean }>(
        "SELECT last_active_at < now() - interval '1 hour' AS stale FROM rooms WHERE id = $1",
        [room.id],
      );
      expect(rows[0]?.stale).toBe(false);
    });
  });

  describe('GET /rooms/:code/participants', () => {
    it('lists everybody in join order, flagging the host and the guests', async () => {
      const host = await seedUser(db, { displayName: 'Host' });
      const create = await request(app)
        .post('/rooms')
        .set('Cookie', await signedInAs(host.id))
        .send({ name: 'Sprint 42', deckType: 'fibonacci' });
      const code = create.body.room.code;

      await request(app).post(`/rooms/${code}/join`).send({ displayName: 'Khách 1' });
      await request(app).post(`/rooms/${code}/join`).send({ displayName: 'Khách 2' });

      const response = await request(app).get(`/rooms/${code}/participants`);

      expect(response.status).toBe(200);
      expect(response.body.participants).toHaveLength(3);
      expect(response.body.participants.map((p: { displayName: string }) => p.displayName)).toEqual(
        ['Host', 'Khách 1', 'Khách 2'],
      );
      expect(response.body.participants[0]).toMatchObject({ isHost: true, isGuest: false });
      expect(response.body.participants[1]).toMatchObject({ isHost: false, isGuest: true });
    });

    it('returns an empty list for a room nobody has joined yet', async () => {
      const room = await seedRoom(db, { code: 'AB12CD34' });

      const response = await request(app).get(`/rooms/${room.code}/participants`);

      expect(response.status).toBe(200);
      expect(response.body.participants).toEqual([]);
    });

    it('answers 404 for an unknown room rather than an empty list', async () => {
      const response = await request(app).get('/rooms/ZZ99ZZ99/participants');

      expect(response.status).toBe(404);
    });
  });

  it('answers a malformed JSON body with 400, not 500', async () => {
    const response = await request(app)
      .post('/rooms')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});
