import type { RoundStatus } from '@planning-poker/shared';
import { expectOne } from './users.js';
import { type Queryable, type VotingRound } from './types.js';

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

export async function listRounds(db: Queryable, roomId: string): Promise<VotingRound[]> {
  const { rows } = await db.query<RoundRow>(
    `SELECT ${ROUND_COLUMNS} FROM voting_rounds WHERE room_id = $1 ORDER BY round_number`,
    [roomId],
  );
  return rows.map(mapRound);
}
