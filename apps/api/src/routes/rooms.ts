import {
  isDeckType,
  MAX_GUEST_NAME_LENGTH,
  type RoomHistoryDetailResponse,
} from '@planning-poker/shared';
import { Router } from 'express';
import type pg from 'pg';
import {
  addParticipant,
  createRoom,
  createRound,
  ensureCurrentRound,
  findRoomByCode,
  findUserById,
  isRoomMember,
  listRoundsWithVotes,
  listVotesForRound,
  type Participant,
  type Queryable,
  type Room,
  setParticipantOnline,
  setRoomHostParticipant,
  touchRoom,
} from '../db/repositories/index.js';
import {
  findParticipantInRoom,
  listParticipantsWithUsers,
  renameParticipant,
} from '../db/repositories/participants.js';
import { withTransaction } from '../db/transaction.js';
import { toParticipantDto, toRoomDto, toRoundStateDto } from '../http/dto.js';
import { asyncRoute, badRequest, forbidden, notFound, unauthorized } from '../http/errors.js';
import { canViewRoomHistory, toRoundHistoryEntryDto } from '../http/history.js';
import { resolveCaller } from '../http/session.js';

/**
 * Room creation and joining over REST (PRD FR-1, FR-2, FR-3).
 *
 * The participant list here is a plain GET; `apps/api/src/realtime/` streams the same rows over
 * Socket.io so the browser no longer has to poll it.
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
    hostParticipantId: room.hostParticipantId,
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

      // One transaction, because a room is not usable without its three parts: the row itself,
      // the creator's seat, and the host link between them. A guest-created room has no
      // `host_id` to fall back on (PRD §7), so if `host_participant_id` were written separately
      // and that write were lost, the room would exist with nobody able to reveal in it.
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
        const hosted = (await setRoomHostParticipant(db, created.id, seat.id)) ?? created;
        // Round 1 opens with the room, so the first person in can vote without waiting for
        // anybody to press anything.
        await createRound(db, created.id);
        return { room: hosted, participant: seat };
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
          toParticipantDto(participant, {
            hostId: room.hostId,
            hostParticipantId: room.hostParticipantId,
          }),
        ),
      });
    }),
  );

  /**
   * FR-4/FR-6 over REST: the current round, and what the caller is allowed to know about it.
   *
   * This is the same `toRoundStateDto` the socket snapshot and the reveal broadcast go through,
   * so there is no second opinion about when a card value becomes public — while the round is
   * `voting` this endpoint returns who has voted and nothing else, for anybody who asks. That
   * makes the secrecy guarantee testable from outside the socket layer entirely.
   */
  router.get(
    '/:code/round',
    asyncRoute(async (req, res) => {
      const room = await requireRoom(pool, req.params.code ?? '');
      const round = await ensureCurrentRound(pool, room.id);
      const votes = await listVotesForRound(pool, round.id);

      res.status(200).json(toRoundStateDto(round, votes, room.deckType));
    }),
  );

  /**
   * FR-9: every round this room has had, with the results of the ones that were revealed.
   *
   * The same data the room computed live at reveal time (task 6), asked for after the fact —
   * and computed the same way, since each entry goes through `toRoundStateDto`. A round still
   * `voting` when everyone went home therefore appears in the list with its votes withheld,
   * exactly as it would in the room itself.
   *
   * Membership is checked against `room_participants.user_id`, so knowing a room code is not
   * enough: the invite link gets you into a room, not into its archive.
   */
  router.get(
    '/:code/rounds',
    asyncRoute(async (req, res) => {
      const caller = await resolveCaller(req);
      const room = await requireRoom(pool, req.params.code ?? '');

      const isMember = caller ? await isRoomMember(pool, room.id, caller.userId) : false;
      if (!canViewRoomHistory({ callerUserId: caller?.userId ?? null, isMember })) {
        // 401 and 403 answer different questions, and the history screen shows different things
        // for them: "sign in" versus "this session is not one of yours".
        throw caller
          ? forbidden('you did not take part in this room')
          : unauthorized('you must be signed in to see session history');
      }

      const [participants, rounds] = await Promise.all([
        listParticipantsWithUsers(pool, room.id),
        listRoundsWithVotes(pool, room.id),
      ]);

      const body: RoomHistoryDetailResponse = {
        room: toRoomDto(room),
        participants: participants.map((participant) =>
          toParticipantDto(participant, {
            hostId: room.hostId,
            hostParticipantId: room.hostParticipantId,
          }),
        ),
        rounds: rounds.map((entry) => toRoundHistoryEntryDto(entry, room.deckType)),
      };
      res.status(200).json(body);
    }),
  );

  return router;
}
