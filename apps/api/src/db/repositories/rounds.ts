import type { RoundStatus } from '@planning-poker/shared';
import { expectOne } from './users.js';
import type { Queryable, VotingRound } from './types.js';

interface RoundRow {
  id: string;
  room_id: string;
  round_number: number;
  status: RoundStatus;
  created_at: Date;
  revealed_at: Date | null;
}

export function mapRound(row: RoundRow): VotingRound {
  return {
    id: row.id,
    roomId: row.room_id,
    roundNumber: row.round_number,
    status: row.status,
    createdAt: row.created_at,
    revealedAt: row.revealed_at,
  };
}

const ROUND_COLUMNS = 'id, room_id, round_number, status, created_at, revealed_at';

/**
 * Opens the next round in a room. The round number is derived inside the INSERT rather than
 * read-then-written, so two hosts clicking "new round" at once cannot both compute the same
 * number — one of them loses the (room_id, round_number) unique index and can retry.
 */
export async function createRound(db: Queryable, roomId: string): Promise<VotingRound> {
  const { rows } = await db.query<RoundRow>(
    `INSERT INTO voting_rounds (room_id, round_number)
     SELECT $1, COALESCE(MAX(round_number), 0) + 1 FROM voting_rounds WHERE room_id = $1
     RETURNING ${ROUND_COLUMNS}`,
    [roomId],
  );
  return mapRound(expectOne(rows, 'round insert returned no row'));
}

/** The room's newest round — the one currently being voted on or just revealed. */
export async function findCurrentRound(db: Queryable, roomId: string): Promise<VotingRound | null> {
  const { rows } = await db.query<RoundRow>(
    `SELECT ${ROUND_COLUMNS} FROM voting_rounds
     WHERE room_id = $1
     ORDER BY round_number DESC
     LIMIT 1`,
    [roomId],
  );
  const row = rows[0];
  return row ? mapRound(row) : null;
}

export async function findRoundById(db: Queryable, id: string): Promise<VotingRound | null> {
  const { rows } = await db.query<RoundRow>(
    `SELECT ${ROUND_COLUMNS} FROM voting_rounds WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? mapRound(row) : null;
}

/**
 * Locks the round row for the life of the caller's transaction, so a concurrent `revealRound`
 * cannot flip the row's status between this read and whatever the caller does next (castVote's
 * guard against voting into an already-revealed round). Callers outside a transaction get no
 * benefit from the lock, but the read itself is still correct.
 */
export async function lockRoundForUpdate(
  db: Queryable,
  roundId: string,
): Promise<VotingRound | null> {
  const { rows } = await db.query<RoundRow>(
    `SELECT ${ROUND_COLUMNS} FROM voting_rounds WHERE id = $1 FOR UPDATE`,
    [roundId],
  );
  const row = rows[0];
  return row ? mapRound(row) : null;
}

/**
 * Flips a round to `revealed`, stamping revealed_at in the same statement to satisfy the
 * status/revealed_at check constraint. Already-revealed rounds are left alone (the WHERE
 * clause makes this idempotent), so a double-click cannot move the reveal timestamp.
 */
export async function revealRound(db: Queryable, roundId: string): Promise<VotingRound | null> {
  const { rows } = await db.query<RoundRow>(
    `UPDATE voting_rounds
     SET status = 'revealed', revealed_at = now()
     WHERE id = $1 AND status = 'voting'
     RETURNING ${ROUND_COLUMNS}`,
    [roundId],
  );
  const row = rows[0];
  return row ? mapRound(row) : null;
}

/**
 * The room's current round, opening round 1 if the room has none yet.
 *
 * A room is created with its first round (see `routes/rooms.ts`), so in practice this only
 * opens one for a room that predates that — or for a fixture that seeded a room directly.
 * The insert is `ON CONFLICT DO NOTHING` rather than left to throw: a caller may run this inside
 * its own transaction (e.g. `handleVoteCast`'s `withTransaction`), where a raised unique-violation
 * would abort that transaction and poison every statement after it, including the very re-read
 * this function needs to recover. A no-op conflict keeps the transaction usable, so the loser of
 * the (room_id, round_number) race can simply re-read the round the winner created.
 */
export async function ensureCurrentRound(db: Queryable, roomId: string): Promise<VotingRound> {
  const existing = await findCurrentRound(db, roomId);
  if (existing) return existing;

  const { rows } = await db.query<RoundRow>(
    `INSERT INTO voting_rounds (room_id, round_number)
     SELECT $1, COALESCE(MAX(round_number), 0) + 1 FROM voting_rounds WHERE room_id = $1
     ON CONFLICT (room_id, round_number) DO NOTHING
     RETURNING ${ROUND_COLUMNS}`,
    [roomId],
  );
  const row = rows[0];
  if (row) return mapRound(row);

  const raced = await findCurrentRound(db, roomId);
  /* c8 ignore next */
  if (!raced) throw new Error('ensureCurrentRound: insert conflicted but no round exists');
  return raced;
}

export async function listRounds(db: Queryable, roomId: string): Promise<VotingRound[]> {
  const { rows } = await db.query<RoundRow>(
    `SELECT ${ROUND_COLUMNS} FROM voting_rounds WHERE room_id = $1 ORDER BY round_number`,
    [roomId],
  );
  return rows.map(mapRound);
}
