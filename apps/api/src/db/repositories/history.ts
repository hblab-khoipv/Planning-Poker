import type { DeckType, RoundStatus } from '@planning-poker/shared';
import { mapRoom } from './rooms.js';
import { mapRound } from './rounds.js';
import type { Queryable, Room, Vote, VotingRound } from './types.js';
import { mapVote } from './votes.js';

/**
 * Reads behind session history (PRD FR-9).
 *
 * Every function here takes a `userId` and filters on `room_participants.user_id`. That is the
 * authorisation boundary, expressed as a join rather than as a check a caller might forget:
 * there is no function in this file that can return a room the user has no seat in, so a route
 * cannot accidentally list every room in the system. Guests are excluded for free — their seats
 * have a NULL `user_id`, which no equality test matches.
 */

/** Guards the id column: a malformed uuid is a 22P02 from Postgres, i.e. a 500 rather than a 404. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A room the user was in, plus the counts the list screen shows without opening it. */
export interface RoomHistoryEntry {
  room: Room;
  participantCount: number;
  roundCount: number;
  revealedRoundCount: number;
  lastRevealedAt: Date | null;
}

interface RoomHistoryRow {
  id: string;
  code: string;
  name: string;
  deck_type: DeckType;
  host_id: string | null;
  host_participant_id: string | null;
  created_at: Date;
  last_active_at: Date;
  participant_count: string;
  round_count: string;
  revealed_round_count: string;
  last_revealed_at: Date | null;
}

/**
 * Every room this user created or took part in, most recently active first.
 *
 * Both halves of "created or participated in" resolve to the same seat: `POST /rooms` seats its
 * creator in the same transaction that creates the room, so a signed-in creator always has a
 * `room_participants` row. Matching on that one fact rather than OR-ing in `rooms.host_id` keeps
 * the rule the endpoints enforce and the rule this query enforces identical — a room you can see
 * in the list is a room you can open, with no second definition of membership to drift.
 *
 * The counts are aggregated in SQL rather than by fetching the rows: a list screen that showed
 * ten rooms would otherwise issue thirty follow-up queries for numbers nobody reads individually.
 * `last_active_at` is the ordering key because every action in a room bumps it (join, vote,
 * reveal, reset), which makes it the room's real activity clock.
 */
export async function listRoomHistoryForUser(
  db: Queryable,
  userId: string,
): Promise<RoomHistoryEntry[]> {
  if (!UUID_PATTERN.test(userId)) return [];

  const { rows } = await db.query<RoomHistoryRow>(
    `SELECT r.id, r.code, r.name, r.deck_type, r.host_id, r.host_participant_id,
            r.created_at, r.last_active_at,
            (SELECT count(*) FROM room_participants p WHERE p.room_id = r.id)
              AS participant_count,
            (SELECT count(*) FROM voting_rounds v WHERE v.room_id = r.id)
              AS round_count,
            (SELECT count(*) FROM voting_rounds v
              WHERE v.room_id = r.id AND v.status = 'revealed')
              AS revealed_round_count,
            (SELECT max(v.revealed_at) FROM voting_rounds v WHERE v.room_id = r.id)
              AS last_revealed_at
       FROM rooms r
      WHERE EXISTS (
              SELECT 1 FROM room_participants mine
               WHERE mine.room_id = r.id AND mine.user_id = $1
            )
      ORDER BY r.last_active_at DESC, r.created_at DESC, r.id`,
    [userId],
  );

  return rows.map((row) => ({
    room: mapRoom(row),
    // node-postgres returns bigint (count()) as a string, so these need parsing, not casting.
    participantCount: Number(row.participant_count),
    roundCount: Number(row.round_count),
    revealedRoundCount: Number(row.revealed_round_count),
    lastRevealedAt: row.last_revealed_at,
  }));
}

/**
 * Whether this user holds a seat in this room — the one question `GET /rooms/:code/rounds` asks
 * before answering. A guest seat has a NULL `user_id` and therefore never matches, which is what
 * makes "only signed-in users get history" a property of the data rather than of a route guard.
 */
export async function isRoomMember(
  db: Queryable,
  roomId: string,
  userId: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(userId)) return false;

  const { rows } = await db.query(
    'SELECT 1 FROM room_participants WHERE room_id = $1 AND user_id = $2 LIMIT 1',
    [roomId, userId],
  );
  return rows.length > 0;
}

/** A round together with every vote cast in it. Values included — see the warning below. */
export interface RoundWithVotes {
  round: VotingRound;
  votes: Vote[];
}

interface RoundWithVotesRow {
  id: string;
  room_id: string;
  round_number: number;
  status: RoundStatus;
  created_at: Date;
  revealed_at: Date | null;
  votes: VoteJson[] | null;
}

interface VoteJson {
  id: string;
  round_id: string;
  participant_id: string;
  value: string;
  voted_at: string;
}

/**
 * Every round in a room, oldest first, each with its votes.
 *
 * This deliberately returns the values of *unrevealed* rounds too, exactly as
 * `listVotesForRound` does, because the caller has to know who voted at all. Keeping the secrecy
 * decision out of the query is the point: it belongs to `toRoundStateDto`, the single place that
 * decides what a client may see (FR-4), and a second implementation of that rule down here is
 * precisely the drift that would eventually disagree with it. Nothing in this file may be sent
 * to a client without passing through that function first.
 *
 * One statement rather than a query per round: a long-running room can have dozens, and the
 * history screen asks for all of them at once.
 */
export async function listRoundsWithVotes(
  db: Queryable,
  roomId: string,
): Promise<RoundWithVotes[]> {
  const { rows } = await db.query<RoundWithVotesRow>(
    `SELECT v.id, v.room_id, v.round_number, v.status, v.created_at, v.revealed_at,
            COALESCE(
              (SELECT json_agg(vote ORDER BY vote.voted_at, vote.id)
                 FROM votes vote
                WHERE vote.round_id = v.id),
              '[]'::json
            ) AS votes
       FROM voting_rounds v
      WHERE v.room_id = $1
      ORDER BY v.round_number`,
    [roomId],
  );

  return rows.map((row) => ({
    round: mapRound(row),
    // json_agg hands back ISO strings where a direct row read would give Date objects, so the
    // timestamps are rebuilt here and every consumer sees one `Vote` shape.
    votes: (row.votes ?? []).map((vote) => mapVote({ ...vote, voted_at: new Date(vote.voted_at) })),
  }));
}
