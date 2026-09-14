import { expectOne } from './users.js';
import {
  ConflictError,
  isUniqueViolation,
  type Participant,
  type Queryable,
  ValidationError,
} from './types.js';

interface ParticipantRow {
  id: string;
  room_id: string;
  user_id: string | null;
  guest_name: string | null;
  joined_at: Date;
  is_online: boolean;
}

export function mapParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    guestName: row.guest_name,
    joinedAt: row.joined_at,
    isOnline: row.is_online,
  };
}

const PARTICIPANT_COLUMNS = 'id, room_id, user_id, guest_name, joined_at, is_online';

export const GUEST_NAME_MAX_LENGTH = 40;

export interface AddParticipantInput {
  roomId: string;
  /** NULL for a guest. */
  userId?: string | null;
  /** Required for guests; optional per-room rename for signed-in users (PRD §3.1.2). */
  guestName?: string | null;
}

/**
 * Validates the identity half of a participant: a guest is identified by their name, a
 * signed-in user by their id, and somebody with neither cannot be shown in the room list.
 */
export function assertParticipantIdentity(input: AddParticipantInput): string | null {
  const guestName = input.guestName?.trim() ?? null;

  if (guestName !== null && guestName.length > GUEST_NAME_MAX_LENGTH) {
    throw new ValidationError(`guest name must be at most ${GUEST_NAME_MAX_LENGTH} characters`);
  }
  if (!input.userId && !guestName) {
    throw new ValidationError('a guest participant must have a display name');
  }

  return guestName === null || guestName.length === 0 ? null : guestName;
}

/**
 * Seats somebody in a room. A signed-in user who rejoins keeps their existing seat (and
 * therefore their votes) rather than getting a second one — the partial unique index on
 * (room_id, user_id) makes that an upsert. Guests get a new row; their browser remembers the
 * returned id and presents it again on reconnect.
 */
export async function addParticipant(
  db: Queryable,
  input: AddParticipantInput,
): Promise<Participant> {
  const guestName = assertParticipantIdentity(input);

  if (input.userId) {
    const { rows } = await db.query<ParticipantRow>(
      `INSERT INTO room_participants (room_id, user_id, guest_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_id, user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET guest_name = COALESCE(EXCLUDED.guest_name, room_participants.guest_name),
                     is_online = true
       RETURNING ${PARTICIPANT_COLUMNS}`,
      [input.roomId, input.userId, guestName],
    );
    return mapParticipant(expectOne(rows, 'participant upsert returned no row'));
  }

  try {
    const { rows } = await db.query<ParticipantRow>(
      `INSERT INTO room_participants (room_id, user_id, guest_name)
       VALUES ($1, NULL, $2)
       RETURNING ${PARTICIPANT_COLUMNS}`,
      [input.roomId, guestName],
    );
    return mapParticipant(expectOne(rows, 'participant insert returned no row'));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('participant already exists in this room');
    }
    throw error;
  }
}

export async function findParticipantById(db: Queryable, id: string): Promise<Participant | null> {
  const { rows } = await db.query<ParticipantRow>(
    `SELECT ${PARTICIPANT_COLUMNS} FROM room_participants WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? mapParticipant(row) : null;
}

export async function listParticipants(db: Queryable, roomId: string): Promise<Participant[]> {
  const { rows } = await db.query<ParticipantRow>(
    `SELECT ${PARTICIPANT_COLUMNS} FROM room_participants WHERE room_id = $1 ORDER BY joined_at, id`,
    [roomId],
  );
  return rows.map(mapParticipant);
}

/**
 * Marks somebody online or offline. This is what a socket disconnect uses: the seat and its
 * votes survive, so a dropped connection does not wipe a vote that was already cast.
 */
export async function setParticipantOnline(
  db: Queryable,
  participantId: string,
  isOnline: boolean,
): Promise<Participant | null> {
  const { rows } = await db.query<ParticipantRow>(
    `UPDATE room_participants SET is_online = $2 WHERE id = $1 RETURNING ${PARTICIPANT_COLUMNS}`,
    [participantId, isOnline],
  );
  const row = rows[0];
  return row ? mapParticipant(row) : null;
}

/**
 * Removes a seat outright, cascading its votes away. Used for an explicit "leave room", as
 * opposed to the temporary offline state above.
 */
export async function removeParticipant(db: Queryable, participantId: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM room_participants WHERE id = $1', [
    participantId,
  ]);
  return (rowCount ?? 0) > 0;
}
