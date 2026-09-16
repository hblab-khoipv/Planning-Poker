import { type DeckType, isDeckType } from '@planning-poker/shared';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../room-code.js';
import { expectOne } from './users.js';
import {
  ConflictError,
  isUniqueViolation,
  type Queryable,
  type Room,
  ValidationError,
} from './types.js';

interface RoomRow {
  id: string;
  code: string;
  name: string;
  deck_type: DeckType;
  host_id: string | null;
  host_participant_id: string | null;
  created_at: Date;
  last_active_at: Date;
}

export function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    deckType: row.deck_type,
    hostId: row.host_id,
    hostParticipantId: row.host_participant_id,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

const ROOM_COLUMNS =
  'id, code, name, deck_type, host_id, host_participant_id, created_at, last_active_at';

export const ROOM_NAME_MAX_LENGTH = 80;

/** How many fresh codes to try before giving up, in the vanishingly rare case of a collision. */
const CODE_ATTEMPTS = 5;

export interface CreateRoomInput {
  name: string;
  deckType: DeckType;
  /** NULL when the host is a guest (PRD §7). */
  hostId?: string | null;
  /** Overrides the generated code. Tests use it; application code should not. */
  code?: string;
}

export function assertValidRoomName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('room name must not be empty');
  }
  if (trimmed.length > ROOM_NAME_MAX_LENGTH) {
    throw new ValidationError(`room name must be at most ${ROOM_NAME_MAX_LENGTH} characters`);
  }
  return trimmed;
}

export async function createRoom(db: Queryable, input: CreateRoomInput): Promise<Room> {
  const name = assertValidRoomName(input.name);
  if (!isDeckType(input.deckType)) {
    throw new ValidationError(`unknown deck type: ${String(input.deckType)}`);
  }
  if (input.code !== undefined && !isValidRoomCode(input.code)) {
    throw new ValidationError(`invalid room code: ${input.code}`);
  }

  // A generated code can in principle collide with an existing one. Rather than checking first
  // (which races), let the unique index decide and retry with a new code.
  const attempts = input.code === undefined ? CODE_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = input.code ?? generateRoomCode();
    try {
      const { rows } = await db.query<RoomRow>(
        `INSERT INTO rooms (code, name, deck_type, host_id)
         VALUES ($1, $2, $3, $4)
         RETURNING ${ROOM_COLUMNS}`,
        [code, name, input.deckType, input.hostId ?? null],
      );
      return mapRoom(expectOne(rows, 'room insert returned no row'));
    } catch (error) {
      if (!isUniqueViolation(error, 'rooms_code_key')) throw error;
      if (attempt === attempts - 1) {
        throw new ConflictError(`room code ${code} is already taken`);
      }
    }
  }

  /* c8 ignore next */
  throw new Error('unreachable: room creation loop exited without result');
}

/**
 * Looks a room up by its join code. The input is normalised first, so codes pasted from chat
 * with stray whitespace or lower case still resolve.
 */
export async function findRoomByCode(db: Queryable, code: string): Promise<Room | null> {
  const normalized = normalizeRoomCode(code);
  if (!isValidRoomCode(normalized)) return null;

  const { rows } = await db.query<RoomRow>(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE code = $1`, [
    normalized,
  ]);
  const row = rows[0];
  return row ? mapRoom(row) : null;
}

export async function findRoomById(db: Queryable, id: string): Promise<Room | null> {
  const { rows } = await db.query<RoomRow>(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? mapRoom(row) : null;
}

/**
 * Records which seat hosts the room (migration 0004).
 *
 * Only ever fills a NULL, so this cannot be used to steal a room: once a room has a host seat,
 * the only thing that clears it is that seat being deleted. `POST /rooms` calls it inside the
 * same transaction that creates the room and seats its creator, so a room is never visible
 * without a host.
 */
export async function setRoomHostParticipant(
  db: Queryable,
  roomId: string,
  participantId: string,
): Promise<Room | null> {
  const { rows } = await db.query<RoomRow>(
    `UPDATE rooms SET host_participant_id = $2
      WHERE id = $1 AND host_participant_id IS NULL
      RETURNING ${ROOM_COLUMNS}`,
    [roomId, participantId],
  );
  const row = rows[0];
  return row ? mapRoom(row) : null;
}

/** Bumps `last_active_at`, which is what the 24h idle-room sweep reads (PRD §3.1.9). */
export async function touchRoom(db: Queryable, roomId: string): Promise<Room | null> {
  const { rows } = await db.query<RoomRow>(
    `UPDATE rooms SET last_active_at = now() WHERE id = $1 RETURNING ${ROOM_COLUMNS}`,
    [roomId],
  );
  const row = rows[0];
  return row ? mapRoom(row) : null;
}

/** What a swept room leaves behind in the log (see jobs/room-cleanup.ts). */
export interface DeletedRoomSummary {
  id: string;
  code: string;
  lastActiveAt: Date;
}

/**
 * Deletes every room whose last activity predates `cutoff` (PRD §3.1.9 / FR-10).
 *
 * The cutoff arrives as an absolute instant rather than a window in hours, so the caller that
 * decides what "stale" means is the same one that logs it — see `staleCutoff` in
 * `jobs/room-cleanup.ts`, where that rule is unit tested without a database.
 *
 * Only `rooms` is named here. `room_participants`, `voting_rounds` and `votes` all reference it
 * with ON DELETE CASCADE (migration 0002), so the room's whole subtree goes with it, while
 * `users`/`accounts`/`sessions` — permanent per PRD §7 — are untouched: the only foreign keys
 * pointing from a room at a user are ON DELETE SET NULL in the other direction.
 *
 * The RETURNING clause is what makes the sweep observable: the job logs the rooms by code
 * rather than only counting them.
 */
export async function deleteRoomsIdleBefore(
  db: Queryable,
  cutoff: Date,
): Promise<DeletedRoomSummary[]> {
  if (Number.isNaN(cutoff.getTime())) {
    throw new ValidationError('cutoff must be a valid date');
  }
  const { rows } = await db.query<Pick<RoomRow, 'id' | 'code' | 'last_active_at'>>(
    `DELETE FROM rooms WHERE last_active_at < $1
     RETURNING id, code, last_active_at`,
    [cutoff],
  );
  return rows.map((row) => ({ id: row.id, code: row.code, lastActiveAt: row.last_active_at }));
}
