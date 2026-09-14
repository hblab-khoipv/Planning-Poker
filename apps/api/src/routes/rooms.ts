import { isDeckType, MAX_GUEST_NAME_LENGTH } from '@planning-poker/shared';
import { Router } from 'express';
import type pg from 'pg';
import {
  addParticipant,
  createRoom,
  findRoomByCode,
  findUserById,
  type Participant,
  type Queryable,
  type Room,
  setParticipantOnline,
  touchRoom,
} from '../db/repositories/index.js';
import {
  findParticipantInRoom,
  listParticipantsWithUsers,
  renameParticipant,
} from '../db/repositories/participants.js';
import { withTransaction } from '../db/transaction.js';
import { toParticipantDto, toRoomDto } from '../http/dto.js';
import { asyncRoute, badRequest, notFound } from '../http/errors.js';
import { resolveCaller } from '../http/session.js';

/**
 * Room creation and joining over REST (PRD FR-1, FR-2, FR-3).
 *
 * The participant list here is a plain GET the browser polls; task 5 replaces the polling with
 * the Socket.io stream these same rows will feed.
 */

/** Body fields arrive as `unknown` from JSON: anything but a string is a 400, not a cast. */
function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  return value;
}

function readRequiredString(value: unknown, field: string): string {
  const text = readOptionalString(value, field);
  if (text === undefined || text.trim().length === 0) throw badRequest(`${field} is required`);
  return text;
}

function readDeckType(value: unknown): 'fibonacci' | 'tshirt' {
  if (!isDeckType(value)) throw badRequest('deckType must be one of: fibonacci, tshirt');
  return value;
}

/**
 * The name this person will be shown under. A signed-in caller may leave it out (their account
 * name is used); a guest may not, because a seat with no name at all is unidentifiable.
 */
function readDisplayName(value: unknown, options: { required: boolean }): string | undefined {
  const raw = readOptionalString(value, 'displayName');
  const trimmed = raw?.trim() ?? '';

  if (trimmed.length === 0) {
    if (options.required) throw badRequest('displayName is required when you are not signed in');
    return undefined;
  }
  if (trimmed.length > MAX_GUEST_NAME_LENGTH) {
    throw badRequest(`displayName must be at most ${MAX_GUEST_NAME_LENGTH} characters`);
  }
  return trimmed;
}

async function requireRoom(db: Queryable, code: string): Promise<Room> {
  const room = await findRoomByCode(db, code);
  if (!room) throw notFound('room not found');
  return room;
}

/** A freshly written seat needs the account name to render, which the write does not return. */
async function participantResponse(
  db: Queryable,
  room: Room,
  participant: Participant,
): Promise<ReturnType<typeof toParticipantDto>> {
  const user = participant.userId ? await findUserById(db, participant.userId) : null;
  return toParticipantDto(participant, {
    userName: user?.displayName ?? null,
    hostId: room.hostId,
  });
}

/**
 * Seats somebody who is joining. A signed-in user always lands on their existing seat (the
 * partial unique index makes the insert an upsert), so rejoining after a reload keeps the votes
 * they already cast. A guest has no user id to key on, so their browser presents the
 * participant id it stored for this room instead; anything else gets a new seat.
 */
async function seatParticipant(
  db: Queryable,
  room: Room,
  input: { userId: string | null; displayName?: string; participantId?: string },
): Promise<Participant> {
  if (input.userId) {
    return addParticipant(db, {
      roomId: room.id,
      userId: input.userId,
      guestName: input.displayName ?? null,
    });
  }

  if (input.participantId) {
    const existing = await findParticipantInRoom(db, room.id, input.participantId);
    if (existing && existing.userId === null) {
      const renamed = input.displayName
        ? await renameParticipant(db, existing.id, input.displayName)
        : await setParticipantOnline(db, existing.id, true);
      return renamed ?? existing;
    }
  }

  return addParticipant(db, { roomId: room.id, guestName: input.displayName ?? null });
}

export function createRoomsRouter(pool: pg.Pool): Router {
  const router = Router();

  // FR-1: create a room. The creator is seated immediately, as host when they are signed in.
  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const caller = await resolveCaller(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const name = readRequiredString(body.name, 'name');
      const deckType = readDeckType(body.deckType);
      const displayName = readDisplayName(body.displayName, { required: caller === null });

      const { room, participant } = await withTransaction(pool, async (db) => {
        const created = await createRoom(db, {
          name,
          deckType,
          hostId: caller?.userId ?? null,
        });
        const seat = await seatParticipant(db, created, {
          userId: caller?.userId ?? null,
          displayName,
        });
        return { room: created, participant: seat };
      });

      res.status(201).json({
        room: toRoomDto(room),
        participant: await participantResponse(pool, room, participant),
      });
    }),
  );

  // Lets the join screen tell "wrong code" from "room is gone" before asking for a name.
  router.get(
    '/:code',
    asyncRoute(async (req, res) => {
      const room = await requireRoom(pool, req.params.code ?? '');
      res.status(200).json({ room: toRoomDto(room) });
    }),
  );

  // FR-2: join. Unknown code is a 404; a signed-in rejoin reuses the existing seat.
  router.post(
    '/:code/join',
    asyncRoute(async (req, res) => {
      const caller = await resolveCaller(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const participantId = readOptionalString(body.participantId, 'participantId');

      const room = await requireRoom(pool, req.params.code ?? '');
      const displayName = readDisplayName(body.displayName, {
        required: caller === null && !participantId,
      });

      const participant = await withTransaction(pool, async (db) => {
        const seat = await seatParticipant(db, room, {
          userId: caller?.userId ?? null,
          displayName,
          participantId,
        });
        await touchRoom(db, room.id);
        return seat;
      });

      res.status(200).json({
        room: toRoomDto(room),
        participant: await participantResponse(pool, room, participant),
      });
    }),
  );

  // FR-3, without the realtime half: task 5 pushes these same rows over Socket.io.
  router.get(
    '/:code/participants',
    asyncRoute(async (req, res) => {
      const room = await requireRoom(pool, req.params.code ?? '');
      const participants = await listParticipantsWithUsers(pool, room.id);

      res.status(200).json({
        participants: participants.map((participant) =>
          toParticipantDto(participant, { hostId: room.hostId }),
        ),
      });
    }),
  );

  return router;
}
