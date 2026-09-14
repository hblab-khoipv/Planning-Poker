import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type ParticipantJoinedPayload,
  type ParticipantLeftPayload,
  type RoomStatePayload,
  SOCKET_ERROR_CODES,
  SOCKET_EVENTS,
} from '@planning-poker/shared';
import { encode } from 'next-auth/jwt';
import type pg from 'pg';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { Server as SocketIoServer } from 'socket.io';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { closePool, getPool } from '../../src/db/pool.js';
import {
  addParticipant,
  findParticipantById,
  type Participant,
  type Room,
} from '../../src/db/repositories/index.js';
import { attachRealtime, type RealtimeHandle } from '../../src/realtime/index.js';
import type { RealtimeServer } from '../../src/realtime/channel.js';
import { seedRoom, seedUser, truncateAll } from '../helpers/seed.js';

/**
 * The realtime layer against a real Socket.io client, a real Socket.io server and real Postgres
 * (PRD FR-3). Nothing is stubbed: the clients connect over a TCP port, the cookies are minted by
 * next-auth's own `encode`, and presence is read back out of the database afterwards.
 *
 * The grace window is squeezed down to a few milliseconds so a departure is observable without
 * the suite sitting still for the production five seconds.
 */

const NEXTAUTH_SECRET = 'integration-next-auth-secret';
const GRACE_MS = 300;

describe('realtime participant presence', () => {
  let db: pg.Pool;
  let httpServer: HttpServer;
  let io: RealtimeServer;
  let realtime: RealtimeHandle;
  let url: string;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    vi.spyOn(config, 'nextAuthSecret', 'get').mockReturnValue(NEXTAUTH_SECRET);
    db = getPool();
    await runMigrations();

    httpServer = createServer(createApp({ pool: db }));
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

  /** Opens a client and resolves once it is connected, or rejects with the refusal message. */
  function open(auth: Record<string, unknown>, extraHeaders?: Record<string, string>) {
    const socket = connect(url, {
      auth,
      transports: ['websocket'],
      ...(extraHeaders ? { extraHeaders } : {}),
      reconnection: false,
    });
    openClients.push(socket);

    return new Promise<ClientSocket>((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (error: Error) => reject(error));
    });
  }

  /** Resolves with the first payload of `event`, or rejects rather than hanging the suite. */
  function nextEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
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

  async function seatedRoom(): Promise<{ room: Room; host: Participant; guest: Participant }> {
    const room = await seedRoom(db);
    const host = await addParticipant(db, { roomId: room.id, guestName: 'Khôi (host)' });
    const guest = await addParticipant(db, { roomId: room.id, guestName: 'Lan' });
    return { room, host, guest };
  }

  describe('handshake', () => {
    it('refuses a connection that never joined the room over REST', async () => {
      const { room } = await seatedRoom();

      await expect(
        open({ roomCode: room.code, participantId: '99999999-9999-4999-8999-999999999999' }),
      ).rejects.toThrow(SOCKET_ERROR_CODES.NOT_A_PARTICIPANT);
    });

    it('refuses a guest with no seat id', async () => {
      const { room } = await seatedRoom();

      await expect(open({ roomCode: room.code })).rejects.toThrow(
        SOCKET_ERROR_CODES.NOT_A_PARTICIPANT,
      );
    });

    it('refuses a code that belongs to no room', async () => {
      await expect(open({ roomCode: 'ZZ99ZZ99' })).rejects.toThrow(
        SOCKET_ERROR_CODES.ROOM_NOT_FOUND,
      );
    });

    it('refuses a handshake with no room code at all', async () => {
      await expect(open({})).rejects.toThrow(SOCKET_ERROR_CODES.INVALID_HANDSHAKE);
    });

    it('recognises a signed-in participant from the NextAuth cookie alone', async () => {
      const user = await seedUser(db, { displayName: 'Khôi Phạm' });
      const room = await seedRoom(db, { hostId: user.id });
      await addParticipant(db, { roomId: room.id, userId: user.id });

      const token = await encode({ token: { sub: user.id }, secret: NEXTAUTH_SECRET });
      const socket = await open(
        { roomCode: room.code },
        { cookie: `next-auth.session-token=${token}` },
      );

      const state = await nextEvent<RoomStatePayload>(socket, SOCKET_EVENTS.ROOM_STATE);
      expect(state.roomCode).toBe(room.code);
      expect(state.participants).toHaveLength(1);
      expect(state.participants[0]).toMatchObject({
        displayName: 'Khôi Phạm',
        isGuest: false,
        isHost: true,
      });
    });
  });

  describe('two clients in one room', () => {
    it('each sees the other join, and the leaver flips is_online in Postgres', async () => {
      const { room, host, guest } = await seatedRoom();

      const first = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(first, SOCKET_EVENTS.ROOM_STATE);

      // The first client is already listening when the second one arrives.
      const seesGuestJoin = nextEvent<ParticipantJoinedPayload>(
        first,
        SOCKET_EVENTS.PARTICIPANT_JOINED,
      );
      const second = await open({ roomCode: room.code, participantId: guest.id });
      const secondState = await nextEvent<RoomStatePayload>(second, SOCKET_EVENTS.ROOM_STATE);

      // The newcomer's snapshot already contains the person who was there first.
      expect(secondState.participants.map((p) => p.displayName)).toEqual(['Khôi (host)', 'Lan']);

      const joined = await seesGuestJoin;
      expect(joined.participant).toMatchObject({
        id: guest.id,
        displayName: 'Lan',
        isGuest: true,
        isOnline: true,
      });

      await expect(findParticipantById(db, guest.id)).resolves.toMatchObject({ isOnline: true });

      const seesGuestLeave = nextEvent<ParticipantLeftPayload>(
        first,
        SOCKET_EVENTS.PARTICIPANT_LEFT,
      );
      second.disconnect();

      expect(await seesGuestLeave).toEqual({ participantId: guest.id });
      await expect(findParticipantById(db, guest.id)).resolves.toMatchObject({ isOnline: false });
      await expect(findParticipantById(db, host.id)).resolves.toMatchObject({ isOnline: true });
    });

    it('keeps a room’s events inside that room', async () => {
      const { room, host } = await seatedRoom();
      const other = await seedRoom(db, { name: 'Another room' });
      const bystander = await addParticipant(db, { roomId: other.id, guestName: 'Minh' });

      const watcher = await open({ roomCode: other.code, participantId: bystander.id });
      await nextEvent<RoomStatePayload>(watcher, SOCKET_EVENTS.ROOM_STATE);

      const leaked = vi.fn();
      watcher.on(SOCKET_EVENTS.PARTICIPANT_JOINED, leaked);
      watcher.on(SOCKET_EVENTS.PARTICIPANT_LEFT, leaked);

      const joiner = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(joiner, SOCKET_EVENTS.ROOM_STATE);
      joiner.disconnect();

      await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 4));
      expect(leaked).not.toHaveBeenCalled();
    });

    it('a reconnect inside the grace window is not a departure', async () => {
      const { room, host, guest } = await seatedRoom();

      const watcher = await open({ roomCode: room.code, participantId: host.id });
      await nextEvent<RoomStatePayload>(watcher, SOCKET_EVENTS.ROOM_STATE);

      const first = await open({ roomCode: room.code, participantId: guest.id });
      await nextEvent<ParticipantJoinedPayload>(watcher, SOCKET_EVENTS.PARTICIPANT_JOINED);

      const churn = vi.fn();
      watcher.on(SOCKET_EVENTS.PARTICIPANT_LEFT, churn);
      watcher.on(SOCKET_EVENTS.PARTICIPANT_JOINED, churn);

      first.disconnect();
      const again = await open({ roomCode: room.code, participantId: guest.id });
      await nextEvent<RoomStatePayload>(again, SOCKET_EVENTS.ROOM_STATE);

      await new Promise((resolve) => setTimeout(resolve, GRACE_MS * 4));

      // Nobody in the room saw the drop at all, and the seat never went offline.
      expect(churn).not.toHaveBeenCalled();
      await expect(findParticipantById(db, guest.id)).resolves.toMatchObject({ isOnline: true });
    });
  });
});
