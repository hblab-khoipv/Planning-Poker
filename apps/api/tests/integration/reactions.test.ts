import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type ActionAck,
  type ReactionThrownPayload,
  type RoomStatePayload,
  SOCKET_EVENTS,
  VOTE_ERROR_CODES,
} from '@planning-poker/shared';
import type pg from 'pg';
import { Server as SocketIoServer } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';
import {
  addParticipant,
  createRound,
  findCurrentRound,
  type Participant,
  type Room,
  setRoomHostParticipant,
} from '../../src/db/repositories/index.js';
import type { RealtimeServer } from '../../src/realtime/channel.js';
import { attachRealtime, type RealtimeHandle } from '../../src/realtime/index.js';
import { seedRoom, truncateAll } from '../helpers/seed.js';

/**
 * Thrown emoji over real sockets and real Postgres.
 *
 * What is worth proving here is the three things that are not visible from a unit test: the
 * throw reaches *other* clients, it is refused when the palette or the room says so, and it
 * leaves the round exactly as it found it — a reaction must never be mistaken for a vote.
 *
 * The rate limit is squeezed to a tiny budget through `attachRealtime`, the same way the
 * presence suite squeezes the disconnect grace window.
 */

const MAX_PER_WINDOW = 2;

describe('thrown emoji reactions', () => {
  let db: pg.Pool;
  let httpServer: HttpServer;
  let io: RealtimeServer;
  let realtime: RealtimeHandle;
  let url: string;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    db = getPool();
    await runMigrations();

    httpServer = createServer(createApp({ pool: db }));
    io = new SocketIoServer(httpServer, { cors: { origin: true, credentials: true } });
    realtime = attachRealtime(io, db, {
      graceMs: 200,
      reactionLimit: { maxPerWindow: MAX_PER_WINDOW, windowMs: 60_000 },
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    realtime.close();
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
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

  async function seatedRoom(): Promise<{ room: Room; host: Participant; lan: Participant }> {
    const created = await seedRoom(db);
    const host = await addParticipant(db, { roomId: created.id, guestName: 'Khôi (host)' });
    const lan = await addParticipant(db, { roomId: created.id, guestName: 'Lan' });
    const room = (await setRoomHostParticipant(db, created.id, host.id)) ?? created;
    await createRound(db, room.id);
    return { room, host, lan };
  }

  /** Opens a socket and waits for its snapshot, so later events cannot be missed. */
  async function seated(room: Room, participant: Participant): Promise<ClientSocket> {
    const socket = await open({ roomCode: room.code, participantId: participant.id });
    await nextEvent<RoomStatePayload>(socket, SOCKET_EVENTS.ROOM_STATE);
    return socket;
  }

  it('relays a throw at the table to everybody, sender included', async () => {
    const { room, host, lan } = await seatedRoom();
    const hostSocket = await seated(room, host);
    const lanSocket = await seated(room, lan);

    const hostSees = nextEvent<ReactionThrownPayload>(hostSocket, SOCKET_EVENTS.REACTION_THROWN);
    const lanSees = nextEvent<ReactionThrownPayload>(lanSocket, SOCKET_EVENTS.REACTION_THROWN);

    await expect(emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, { emoji: '🎉' })).resolves.toEqual({
      ok: true,
    });

    for (const seen of [await hostSees, await lanSees]) {
      expect(seen).toMatchObject({
        emoji: '🎉',
        fromParticipantId: lan.id,
        targetParticipantId: null,
      });
      expect(typeof seen.id).toBe('string');
      expect(seen.thrownAt).toBeGreaterThan(0);
    }
  });

  it('carries the target seat when one is aimed at', async () => {
    const { room, host, lan } = await seatedRoom();
    const hostSocket = await seated(room, host);
    const lanSocket = await seated(room, lan);

    const hostSees = nextEvent<ReactionThrownPayload>(hostSocket, SOCKET_EVENTS.REACTION_THROWN);
    await expect(
      emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, {
        emoji: '🍅',
        targetParticipantId: host.id,
      }),
    ).resolves.toEqual({ ok: true });

    expect(await hostSees).toMatchObject({
      emoji: '🍅',
      fromParticipantId: lan.id,
      targetParticipantId: host.id,
    });
  });

  it('refuses an emoji outside the palette and a target outside the room', async () => {
    const { room, host, lan } = await seatedRoom();
    const other = await seedRoom(db, { name: 'Another room' });
    const stranger = await addParticipant(db, { roomId: other.id, guestName: 'Người lạ' });
    const lanSocket = await seated(room, lan);

    await expect(
      emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, { emoji: '💣' }),
    ).resolves.toMatchObject({ ok: false, code: VOTE_ERROR_CODES.INVALID_EMOJI });

    await expect(
      emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, {
        emoji: '👍',
        targetParticipantId: stranger.id,
      }),
    ).resolves.toMatchObject({ ok: false, code: VOTE_ERROR_CODES.INVALID_TARGET });

    // A seat in this room is fine, which is what makes the refusal above about the room rather
    // than about targets in general.
    await expect(
      emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, {
        emoji: '👍',
        targetParticipantId: host.id,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('rate-limits one seat without touching another', async () => {
    const { room, host, lan } = await seatedRoom();
    const hostSocket = await seated(room, host);
    const lanSocket = await seated(room, lan);

    for (let i = 0; i < MAX_PER_WINDOW; i += 1) {
      await expect(emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, { emoji: '🔥' })).resolves.toEqual(
        { ok: true },
      );
    }
    await expect(
      emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, { emoji: '🔥' }),
    ).resolves.toMatchObject({ ok: false, code: VOTE_ERROR_CODES.RATE_LIMITED });

    // The budget is per seat, so the host is unaffected by Lan's spamming.
    await expect(emit(hostSocket, SOCKET_EVENTS.REACTION_THROW, { emoji: '👍' })).resolves.toEqual({
      ok: true,
    });
  });

  it('changes nothing about the round, and persists nothing', async () => {
    const { room, host, lan } = await seatedRoom();
    const lanSocket = await seated(room, lan);
    const before = await findCurrentRound(db, room.id);

    await emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, { emoji: '☕' });
    await emit(lanSocket, SOCKET_EVENTS.REACTION_THROW, {
      emoji: '📄',
      targetParticipantId: host.id,
    });

    expect(await findCurrentRound(db, room.id)).toEqual(before);

    // A client joining afterwards sees no trace of either throw — the whole point of ephemeral.
    const late = await open({ roomCode: room.code, participantId: host.id });
    const snapshot = await nextEvent<RoomStatePayload>(late, SOCKET_EVENTS.ROOM_STATE);
    expect(JSON.stringify(snapshot)).not.toContain('☕');
    expect(snapshot.votedParticipantIds).toEqual([]);
  });
});
