import { SOCKET_EVENTS } from '@planning-poker/shared';
import type pg from 'pg';
import type { Socket } from 'socket.io';
import { config } from '../config.js';
import {
  listParticipantsWithUsers,
  setParticipantOnline,
} from '../db/repositories/participants.js';
import type { Participant, Room } from '../db/repositories/types.js';
import { toParticipantDto } from '../http/dto.js';
import {
  emitParticipantJoined,
  emitParticipantLeft,
  type RealtimeServer,
  roomChannel,
} from './channel.js';
import { authenticateHandshake, SocketAuthError } from './identity.js';
import { PresenceTracker, type PresenceTimers } from './presence.js';

/**
 * The realtime half of FR-3: the participant list, pushed instead of polled.
 *
 * This layer carries live state; it does not create any. REST still owns creating a room and
 * taking a seat in it (`src/routes/rooms.ts`), and a socket may only pick up a seat that already
 * exists — see `identity.ts`. The one piece of state it does own is presence: `is_online` is
 * written here on connect and on a disconnect that outlives the grace window, which is what
 * keeps `GET /rooms/:code/participants` agreeing with what the sockets have seen.
 */

export interface RealtimeOptions {
  /** How long a dropped socket keeps its seat online before it counts as a departure. */
  graceMs?: number;
  /** Injected by the tests so a grace window can pass without really waiting. */
  timers?: PresenceTimers;
}

/** Resolved once per connection and kept on the socket, so handlers never re-read the cookie. */
interface SocketState {
  room: Room;
  participant: Participant;
}

type RoomSocket = Socket & { data: SocketState };

export interface RealtimeHandle {
  /** Cancels any armed grace timers. Tests call it; the process itself just exits. */
  close(): void;
}

export function attachRealtime(
  io: RealtimeServer,
  pool: pg.Pool,
  options: RealtimeOptions = {},
): RealtimeHandle {
  const presence = new PresenceTracker({
    graceMs: options.graceMs ?? config.socketDisconnectGraceMs,
    ...(options.timers ? { timers: options.timers } : {}),
  });

  // Authentication happens once, before `connection` fires: a socket that cannot be resolved to
  // an existing seat never joins a channel, so it cannot receive a single room event.
  io.use((socket, next) => {
    authenticateHandshake(pool, socket.handshake)
      .then((identity) => {
        (socket as RoomSocket).data = identity;
        next();
      })
      .catch((error: unknown) => {
        next(
          error instanceof SocketAuthError
            ? Object.assign(new Error(error.code), { data: { message: error.message } })
            : new Error('realtime handshake failed'),
        );
      });
  });

  io.on('connection', (socket) => {
    const { room, participant } = (socket as RoomSocket).data;
    const channel = roomChannel(room.code);

    void (async () => {
      await socket.join(channel);

      const announce = presence.attach(participant.id, socket.id);
      await setParticipantOnline(pool, participant.id, true);

      // The snapshot goes out before the join is announced, so this socket's own list already
      // contains everybody by the time it starts applying events to it.
      const participants = await listParticipantsWithUsers(pool, room.id);
      socket.emit(SOCKET_EVENTS.ROOM_STATE, {
        roomCode: room.code,
        participants: participants.map((row) => toParticipantDto(row, { hostId: room.hostId })),
      });

      if (announce) {
        const seat = participants.find((row) => row.id === participant.id);
        emitParticipantJoined(
          io,
          room.code,
          toParticipantDto(seat ?? participant, {
            userName: seat?.userName ?? null,
            hostId: room.hostId,
          }),
        );
      }
    })().catch((error: unknown) => {
      console.error('realtime: failed to seat a socket', error);
      socket.disconnect(true);
    });

    socket.on('disconnect', () => {
      presence.detach(participant.id, socket.id, () => {
        void setParticipantOnline(pool, participant.id, false)
          .then(() => {
            emitParticipantLeft(io, room.code, participant.id);
          })
          .catch((error: unknown) => {
            console.error('realtime: failed to mark a participant offline', error);
          });
      });
    });
  });

  return {
    close: () => presence.dispose(),
  };
}

export { roomChannel } from './channel.js';
