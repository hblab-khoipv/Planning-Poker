import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type ActionAck,
  type RoomStatePayload,
  type RoundResetPayload,
  type RoundRevealedPayload,
  type RoundStateResponse,
  SOCKET_EVENTS,
  VOTE_ERROR_CODES,
  type VoteCastPayload,
} from '@planning-poker/shared';
import type pg from 'pg';
import request from 'supertest';
import { Server as SocketIoServer } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';
import {
  addParticipant,
  createRound,
  findCurrentRound,
  listVotesForRound,
  type Participant,
  type Room,
  setRoomHostParticipant,
} from '../../src/db/repositories/index.js';
import type { RealtimeServer } from '../../src/realtime/channel.js';
import { attachRealtime, type RealtimeHandle } from '../../src/realtime/index.js';
import { seedRoom, truncateAll } from '../helpers/seed.js';

/**
 * The whole voting flow (PRD §4 steps 5–8) against real Postgres and real Socket.io clients.
 *
 * The assertions that matter most are the negative ones. FR-4 is a secrecy guarantee, and a
 * secrecy guarantee is only tested by showing that the value is *not* somewhere: not in the
 * `vote:cast` another client receives, not in that client's own `room:state`, and not in the
 * REST read anybody can make. Each of those is a different way a value could escape, so each
 * gets its own check rather than one assertion standing in for all three.
 */

const GRACE_MS = 200;

describe('voting, reveal and new rounds', () => {
  let db: pg.Pool;
  let httpServer: HttpServer;
  let io: RealtimeServer;
  let realtime: RealtimeHandle;
  let url: string;
  let app: ReturnType<typeof createApp>;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    db = getPool();
    await runMigrations();

    app = createApp({ pool: db });
    httpServer = createServer(app);
    io = new SocketIoServer(httpServer, { cors: { origin: true, credentials: true } });
    realtime = attachRealtime(io, db, { graceMs: GRACE_MS });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    realtime.close();
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    vi.restoreAllMocks();
    await closePool();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterEach(() => {
    while (openClients.length > 0) openClients.pop()?.disconnect();
  });

  function open(auth: Record<string, unknown>): Promise<ClientSocket> {
    const socket = connect(url, { auth, transports: ['websocket'], reconnection: false });
    openClients.push(socket);

    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (error: Error) => reject(error));
    });
  }

  function nextEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${event}`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  /** Emits an action and resolves with the server's acknowledgement. */
  function emit(socket: ClientSocket, event: string, payload?: unknown): Promise<ActionAck> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 5000);
      const done = (ack: ActionAck) => {
        clearTimeout(timer);
        resolve(ack);
      };
      if (payload === undefined) socket.emit(event, done);
      else socket.emit(event, payload, done);
    });
  }

  /** A room whose host seat is set the way `POST /rooms` sets it, plus two other guests. */
  async function seatedRoom(
    deckType: 'fibonacci' | 'tshirt' = 'fibonacci',
  ): Promise<{ room: Room; host: Participant; lan: Participant; minh: Participant }> {
    const created = await seedRoom(db, { deckType });
    const host = await addParticipant(db, { roomId: created.id, guestName: 'Khôi (host)' });
    const lan = await addParticipant(db, { roomId: created.id, guestName: 'Lan' });
    const minh = await addParticipant(db, { roomId: created.id, guestName: 'Minh' });
    const room = (await setRoomHostParticipant(db, created.id, host.id)) ?? created;
    await createRound(db, room.id);
    return { room, host, lan, minh };
  }

  describe('POST /rooms', () => {
    it('gives a guest-created room a host seat and an open round 1', async () => {
      const response = await request(app)
        .post('/rooms')
        .send({ name: 'Guest room', deckType: 'fibonacci', displayName: 'Khôi' })
        .expect(201);

      // The guest-hosted case from PRD §7: no account, but still a host.
      expect(response.body.room.hostId).toBeNull();
      expect(response.body.room.hostParticipantId).toBe(response.body.participant.id);
      expect(response.body.participant.isHost).toBe(true);

      const round = await findCurrentRound(db, response.body.room.id as string);
      expect(round).toMatchObject({ roundNumber: 1, status: 'voting' });
    });
  });

  describe('casting a vote (FR-4)', () => {
    it('tells the room somebody voted without telling it what', async () => {
      const { room, host, lan } = await seatedRoom();

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);

      const hostSeesVote = nextEvent<VoteCastPayload>(hostSocket, SOCKET_EVENTS.VOTE_CAST);
      await expect(emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '8' })).resolves.toEqual({
        ok: true,
      });

      const announced = await hostSeesVote;
      expect(announced).toEqual({ participantId: lan.id, hasVoted: true });
      // The event has exactly two fields, neither of which is the card. Asserting on the keys
      // rather than on the serialised text is deliberate: a uuid is hex, so a card like '8' or
      // '13' appears inside participant ids by chance and a substring check would be noise.
      expect(Object.keys(announced).sort()).toEqual(['hasVoted', 'participantId']);

      // ...while the value really is stored server-side.
      const round = await findCurrentRound(db, room.id);
      const stored = await listVotesForRound(db, round!.id);
      expect(stored).toEqual([expect.objectContaining({ participantId: lan.id, value: '8' })]);
    });

    it('keeps another client from reading the value before the reveal, over socket or REST', async () => {
      const { room, host, lan } = await seatedRoom();

      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '13' });

      // A client connecting afterwards gets the full snapshot — which still has no values.
      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      const snapshot = await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);

      expect(snapshot.votedParticipantIds).toEqual([lan.id]);
      expect(snapshot.votes).toEqual([]);
      expect(snapshot.tally).toBeNull();
      expect(snapshot.myVote).toBeNull();
      expect(JSON.stringify(snapshot)).not.toContain('"13"');

      // The REST read anybody can make says exactly as much and no more.
      const rest = await request(app).get(`/rooms/${room.code}/round`).expect(200);
      const body = rest.body as RoundStateResponse;
      expect(body.votedParticipantIds).toEqual([lan.id]);
      expect(body.votes).toEqual([]);
      expect(body.tally).toBeNull();
      expect(JSON.stringify(body)).not.toContain('"13"');
    });

    it('shows a reconnecting voter their own card again, and only their own', async () => {
      const { room, lan, minh } = await seatedRoom();

      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '5' });

      const minhSocket = await open({ roomCode: room.code, participantId: minh.id });
      await nextEvent<RoomStatePayload>(minhSocket, SOCKET_EVENTS.ROOM_STATE);
      await emit(minhSocket, SOCKET_EVENTS.VOTE_CAST, { value: '3' });

      lanSocket.disconnect();
      const lanAgain = await open({ roomCode: room.code, participantId: lan.id });
      const snapshot = await nextEvent<RoomStatePayload>(lanAgain, SOCKET_EVENTS.ROOM_STATE);

      // Her own card survived the drop (PRD §12's reconnect question)...
      expect(snapshot.myVote).toBe('5');
      // ...and Minh's did not come with it.
      expect(snapshot.votes).toEqual([]);
      expect(JSON.stringify(snapshot)).not.toContain('"3"');
    });

    it('replaces a vote rather than adding a second ballot', async () => {
      const { room, lan } = await seatedRoom();

      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);

      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '3' });
      await expect(emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '8' })).resolves.toEqual({
        ok: true,
      });

      const round = await findCurrentRound(db, room.id);
      const stored = await listVotesForRound(db, round!.id);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ value: '8' });
    });

    it('refuses a card that is not in this room’s deck', async () => {
      const { room, lan } = await seatedRoom('fibonacci');

      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);

      await expect(
        emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: 'XL' }),
      ).resolves.toMatchObject({ ok: false, code: VOTE_ERROR_CODES.INVALID_CARD });

      const round = await findCurrentRound(db, room.id);
      await expect(listVotesForRound(db, round!.id)).resolves.toEqual([]);
    });

    it('accepts a t-shirt card in a t-shirt room and refuses a Fibonacci one', async () => {
      const { room, lan } = await seatedRoom('tshirt');

      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);

      await expect(emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: 'L' })).resolves.toEqual({
        ok: true,
      });
      await expect(
        emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '13' }),
      ).resolves.toMatchObject({ ok: false, code: VOTE_ERROR_CODES.INVALID_CARD });
    });
  });

  describe('revealing (FR-5, FR-6)', () => {
    it('sends every client the values, the average, the median and the consensus flag', async () => {
      const { room, host, lan, minh } = await seatedRoom();

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);
      const minhSocket = await open({ roomCode: room.code, participantId: minh.id });
      await nextEvent<RoomStatePayload>(minhSocket, SOCKET_EVENTS.ROOM_STATE);

      await emit(hostSocket, SOCKET_EVENTS.VOTE_CAST, { value: '2' });
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '3' });
      await emit(minhSocket, SOCKET_EVENTS.VOTE_CAST, { value: '8' });

      const everyone = [hostSocket, lanSocket, minhSocket].map((socket) =>
        nextEvent<RoundRevealedPayload>(socket, SOCKET_EVENTS.ROUND_REVEALED),
      );
      await expect(emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL)).resolves.toEqual({ ok: true });

      // All three clients — not just the one that asked — get the same reveal.
      for (const payload of await Promise.all(everyone)) {
        expect(payload.round).toMatchObject({ roundNumber: 1, status: 'revealed' });
        expect(payload.round.revealedAt).not.toBeNull();
        expect([...payload.votes].sort((a, b) => a.value.localeCompare(b.value))).toEqual(
          [
            { participantId: host.id, value: '2' },
            { participantId: minh.id, value: '8' },
            { participantId: lan.id, value: '3' },
          ].sort((a, b) => a.value.localeCompare(b.value)),
        );
        // (2 + 3 + 8) / 3 = 4.33, middle value 3.
        expect(payload.tally).toEqual({
          voteCount: 3,
          numericCount: 3,
          average: 4.33,
          median: 3,
          consensus: false,
        });
      }
    });

    it('flags consensus when everybody chose the same card', async () => {
      const { room, host, lan } = await seatedRoom();

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);

      await emit(hostSocket, SOCKET_EVENTS.VOTE_CAST, { value: '5' });
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '5' });

      const revealed = nextEvent<RoundRevealedPayload>(lanSocket, SOCKET_EVENTS.ROUND_REVEALED);
      await emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL);

      expect((await revealed).tally).toMatchObject({ average: 5, median: 5, consensus: true });
    });

    it('gives a t-shirt room consensus without an average', async () => {
      const { room, host, lan } = await seatedRoom('tshirt');

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);

      await emit(hostSocket, SOCKET_EVENTS.VOTE_CAST, { value: 'M' });
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: 'M' });

      const revealed = nextEvent<RoundRevealedPayload>(lanSocket, SOCKET_EVENTS.ROUND_REVEALED);
      await emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL);

      expect((await revealed).tally).toEqual({
        voteCount: 2,
        numericCount: 0,
        average: null,
        median: null,
        consensus: true,
      });
    });

    it('refuses a non-host, and turns nothing over', async () => {
      const { room, host, lan } = await seatedRoom();

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '8' });

      const leaked = vi.fn();
      hostSocket.on(SOCKET_EVENTS.ROUND_REVEALED, leaked);

      await expect(emit(lanSocket, SOCKET_EVENTS.ROUND_REVEAL)).resolves.toMatchObject({
        ok: false,
        code: VOTE_ERROR_CODES.NOT_HOST,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      // Nobody was told, and the round is untouched in the database.
      expect(leaked).not.toHaveBeenCalled();
      expect(await findCurrentRound(db, room.id)).toMatchObject({
        status: 'voting',
        revealedAt: null,
      });
    });

    it('refuses a vote into a round that has already been revealed', async () => {
      const { room, host, lan } = await seatedRoom();

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);

      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '5' });
      await emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL);

      await expect(emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '1' })).resolves.toMatchObject(
        {
          ok: false,
          code: VOTE_ERROR_CODES.ROUND_NOT_OPEN,
        },
      );
    });

    it('is idempotent: a second reveal does not move revealed_at', async () => {
      const { room, host, lan } = await seatedRoom();

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '5' });

      await emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL);
      const first = await findCurrentRound(db, room.id);

      await expect(emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL)).resolves.toEqual({ ok: true });
      const second = await findCurrentRound(db, room.id);

      expect(second!.revealedAt!.toISOString()).toBe(first!.revealedAt!.toISOString());
    });
  });

  describe('a new round (FR-7)', () => {
    it('opens round 2 for everybody, and the old votes stay out of the new tally', async () => {
      const { room, host, lan, minh } = await seatedRoom();

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);
      const minhSocket = await open({ roomCode: room.code, participantId: minh.id });
      await nextEvent<RoomStatePayload>(minhSocket, SOCKET_EVENTS.ROOM_STATE);

      // Round 1: three votes averaging 8, revealed.
      await emit(hostSocket, SOCKET_EVENTS.VOTE_CAST, { value: '8' });
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '8' });
      await emit(minhSocket, SOCKET_EVENTS.VOTE_CAST, { value: '8' });
      await emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL);

      const resets = [lanSocket, minhSocket].map((socket) =>
        nextEvent<RoundResetPayload>(socket, SOCKET_EVENTS.ROUND_RESET),
      );
      await expect(emit(hostSocket, SOCKET_EVENTS.ROUND_RESET)).resolves.toEqual({ ok: true });

      for (const payload of await Promise.all(resets)) {
        expect(payload.round).toMatchObject({ roundNumber: 2, status: 'voting' });
        expect(payload.round.revealedAt).toBeNull();
      }

      // The new round starts empty for everyone, over REST as well as over the socket.
      const fresh = (await request(app).get(`/rooms/${room.code}/round`).expect(200))
        .body as RoundStateResponse;
      expect(fresh.round).toMatchObject({ roundNumber: 2, status: 'voting' });
      expect(fresh.votedParticipantIds).toEqual([]);
      expect(fresh.votes).toEqual([]);

      // Round 2: two votes of 1. If round 1's 8s leaked in, the average would not be 1.
      await emit(hostSocket, SOCKET_EVENTS.VOTE_CAST, { value: '1' });
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '1' });

      const revealed = nextEvent<RoundRevealedPayload>(minhSocket, SOCKET_EVENTS.ROUND_REVEALED);
      await emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL);
      const payload = await revealed;

      expect(payload.round.roundNumber).toBe(2);
      expect(payload.votes).toHaveLength(2);
      expect(payload.tally).toMatchObject({ voteCount: 2, average: 1, median: 1, consensus: true });

      // Round 1's votes are still on record, on round 1.
      const rounds = await db.query('SELECT id FROM voting_rounds WHERE room_id = $1', [room.id]);
      expect(rounds.rows).toHaveLength(2);
    });

    it('refuses a non-host', async () => {
      const { room, host, lan } = await seatedRoom();

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);

      const leaked = vi.fn();
      hostSocket.on(SOCKET_EVENTS.ROUND_RESET, leaked);

      await expect(emit(lanSocket, SOCKET_EVENTS.ROUND_RESET)).resolves.toMatchObject({
        ok: false,
        code: VOTE_ERROR_CODES.NOT_HOST,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(leaked).not.toHaveBeenCalled();
      expect(await findCurrentRound(db, room.id)).toMatchObject({ roundNumber: 1 });
    });

    it('keeps a room’s reveal inside that room', async () => {
      const { room, host, lan } = await seatedRoom();
      const other = await seedRoom(db, { name: 'Another room' });
      const bystander = await addParticipant(db, { roomId: other.id, guestName: 'Ngoài' });

      const watcher = await open({ roomCode: other.code, participantId: bystander.id });
      await nextEvent<RoomStatePayload>(watcher, SOCKET_EVENTS.ROOM_STATE);
      const leaked = vi.fn();
      watcher.on(SOCKET_EVENTS.ROUND_REVEALED, leaked);
      watcher.on(SOCKET_EVENTS.VOTE_CAST, leaked);

      const hostSocket = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(hostSocket, SOCKET_EVENTS.ROOM_STATE);
      const lanSocket = await open({ roomCode: room.code, participantId: lan.id });
      await nextEvent<RoomStatePayload>(lanSocket, SOCKET_EVENTS.ROOM_STATE);
      await emit(lanSocket, SOCKET_EVENTS.VOTE_CAST, { value: '5' });
      await emit(hostSocket, SOCKET_EVENTS.ROUND_REVEAL);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(leaked).not.toHaveBeenCalled();
    });
  });
});
