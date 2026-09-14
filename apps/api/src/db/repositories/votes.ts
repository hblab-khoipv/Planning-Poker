import { DECKS, type DeckType, isDeckType } from '@planning-poker/shared';
import { expectOne } from './users.js';
import { type Queryable, ValidationError, type Vote } from './types.js';

interface VoteRow {
  id: string;
  round_id: string;
  participant_id: string;
  value: string;
  voted_at: Date;
}

export function mapVote(row: VoteRow): Vote {
  return {
    id: row.id,
    roundId: row.round_id,
    participantId: row.participant_id,
    value: row.value,
    votedAt: row.voted_at,
  };
}

const VOTE_COLUMNS = 'id, round_id, participant_id, value, voted_at';

/**
 * A vote value is only meaningful relative to the room's deck: 'XL' is a real card in a
 * t-shirt room and nonsense in a Fibonacci one. Postgres cannot check this (the deck lives on
 * the room, two joins away), so it is enforced here.
 */
export function assertValidVoteValue(deckType: DeckType, value: string): string {
  if (!isDeckType(deckType)) {
    throw new ValidationError(`unknown deck type: ${String(deckType)}`);
  }
  const deck = DECKS[deckType];
  if (!deck.includes(value)) {
    throw new ValidationError(`"${value}" is not a card in the ${deckType} deck`);
  }
  return value;
}

export interface CastVoteInput {
  roundId: string;
  participantId: string;
  deckType: DeckType;
  value: string;
}

/**
 * Records a vote, replacing that participant's previous one for the round — PRD §3.1.5 lets
 * people change their mind until reveal. The unique index on (round_id, participant_id) is
 * what turns this into an update instead of a second ballot.
 */
export async function castVote(db: Queryable, input: CastVoteInput): Promise<Vote> {
  const value = assertValidVoteValue(input.deckType, input.value);

  const { rows } = await db.query<VoteRow>(
    `INSERT INTO votes (round_id, participant_id, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (round_id, participant_id)
     DO UPDATE SET value = EXCLUDED.value, voted_at = now()
     RETURNING ${VOTE_COLUMNS}`,
    [input.roundId, input.participantId, value],
  );

  return mapVote(expectOne(rows, 'vote upsert returned no row'));
}

/**
 * Every vote in a round. Callers must not forward the values to clients while the round is
 * still `voting` (PRD §7) — before reveal the client only learns *who* has voted.
 */
export async function listVotesForRound(db: Queryable, roundId: string): Promise<Vote[]> {
  const { rows } = await db.query<VoteRow>(
    `SELECT ${VOTE_COLUMNS} FROM votes WHERE round_id = $1 ORDER BY voted_at, id`,
    [roundId],
  );
  return rows.map(mapVote);
}

/** Which participants have voted — safe to publish before reveal (PRD §8 `vote:cast`). */
export async function listVoterIds(db: Queryable, roundId: string): Promise<string[]> {
  const { rows } = await db.query<{ participant_id: string }>(
    'SELECT participant_id FROM votes WHERE round_id = $1 ORDER BY participant_id',
    [roundId],
  );
  return rows.map((row) => row.participant_id);
}

export async function deleteVote(
  db: Queryable,
  roundId: string,
  participantId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM votes WHERE round_id = $1 AND participant_id = $2',
    [roundId, participantId],
  );
  return (rowCount ?? 0) > 0;
}
