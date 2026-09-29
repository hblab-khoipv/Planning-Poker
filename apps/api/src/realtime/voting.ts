import {
  type ActionAck,
  type AckFn,
  SOCKET_EVENTS,
  VOTE_ERROR_CODES,
  type VoteCastRequest,
  type VoteErrorCode,
} from '@planning-poker/shared';
import type pg from 'pg';
import type { Socket } from 'socket.io';
import {
  castVote,
  createRound,
  editRevealedVote,
  ensureCurrentRound,
  findCurrentRound,
  findRoomById,
  findRoundById,
  findVoteForParticipant,
  listVotesForRound,
  lockRoundForUpdate,
  type Participant,
  type Queryable,
  type Room,
  revealRound,
  touchRoom,
  ValidationError,
  type VotingRound,
} from '../db/repositories/index.js';
import { withTransaction } from '../db/transaction.js';
import { isRoomHost } from '../http/authority.js';
import { toRoundDto, toRoundStateDto } from '../http/dto.js';
import {
  emitRoundReset,
  emitRoundRevealed,
  emitVoteCast,
  emitVoteEdited,
  type RealtimeServer,
} from './channel.js';

/**
 * Voting, revealing and starting a new round (PRD §4 steps 5–8, FR-4 → FR-7).
 *
 * Three things shape this module:
 *
 * 1. **A vote's value leaves the server exactly once.** The cast handler answers the room with
 *    `vote:cast`, which by construction carries only a participant id (`channel.ts`), and every
 *    broadcast with card values in it is built by `toRoundStateDto` from a round Postgres has
 *    already flipped to `revealed`. There is no ordering of these calls that reveals early.
 * 2. **Authority is re-read, never remembered.** The room resolved at handshake is a snapshot;
 *    reveal and reset load the room again so the decision is made against the current row.
 * 3. **Refusals are private.** A non-host who clicks "Lật bài" gets an acknowledgement, not an
 *    event — the room never learns somebody tried, and the socket stays up.
 *
 * Issue #11 adds a fourth action, `vote:edit`: changing one's own card after the room has seen
 * it. Its ownership rule is not a check but the absence of a parameter — the payload names a
 * card and nothing else, and the participant comes from the handshake, exactly as it does for
 * `vote:cast`. There is no request a client can send that moves somebody else's card.
 */

/** A refusal, in the shape the client's acknowledgement callback expects. */
export class VoteActionError extends Error {
  constructor(
    readonly code: VoteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VoteActionError';
  }
}

export function ackOk(): ActionAck {
  return { ok: true };
}

export function ackFor(error: unknown): ActionAck {
  if (error instanceof VoteActionError) {
    return { ok: false, code: error.code, message: error.message };
  }
  // A rejected card reaches us as the data layer's own error type (repositories/votes.ts).
  if (error instanceof ValidationError) {
    return { ok: false, code: VOTE_ERROR_CODES.INVALID_CARD, message: error.message };
  }
  return {
    ok: false,
    code: VOTE_ERROR_CODES.INTERNAL,
    message: 'không thực hiện được thao tác này',
  };
}

/** Acknowledgements are optional on the wire, so a client that ignores them still works. */
function respond(ack: AckFn | undefined, result: ActionAck): void {
  if (typeof ack === 'function') ack(result);
}

/**
 * Reads the card out of a `vote:cast` payload. Everything from a socket is attacker-controlled;
 * whether the card exists in the room's deck is settled later, by the data layer.
 */
export function readVoteRequest(payload: unknown): string {
  const request = (payload ?? {}) as Partial<VoteCastRequest>;
  if (typeof request.value !== 'string' || request.value.length === 0) {
    throw new VoteActionError(VOTE_ERROR_CODES.INVALID_CARD, 'value is required');
  }
  return request.value;
}

/**
 * The round a vote may be cast into: the room's current one, and only while it is open.
 *
 * `lockRoundForUpdate` re-reads the round under `FOR UPDATE` after `ensureCurrentRound`, so a
 * caller running inside `withTransaction` blocks on — and then observes the true outcome of —
 * a `revealRound` racing on the same row, instead of trusting a status read moments earlier.
 */
export async function requireOpenRound(db: Queryable, roomId: string): Promise<VotingRound> {
  const round = await ensureCurrentRound(db, roomId);
  const locked = await lockRoundForUpdate(db, round.id);
  if (!locked || locked.status !== 'voting') {
    throw new VoteActionError(
      VOTE_ERROR_CODES.ROUND_NOT_OPEN,
      'round đã được lật bài, hãy chờ round mới',
    );
  }
  return locked;
}

/**
 * The round an edit may be aimed at: the room's current one, and only once it is revealed
 * (issue #11).
 *
 * The mirror image of `requireOpenRound`, and locked for the same reason: inside
 * `withTransaction` the `FOR UPDATE` read makes a concurrent reveal or reset resolve before the
 * edit decides anything, so an edit cannot land on a round whose status changed underneath it.
 * A round still being voted on is refused rather than quietly treated as a plain vote — a client
 * that sent the wrong event needs to hear so, and stamping edit evidence on a card nobody has
 * seen would invent a change the room never witnessed.
 */
export async function requireRevealedRound(db: Queryable, roomId: string): Promise<VotingRound> {
  const round = await ensureCurrentRound(db, roomId);
  const locked = await lockRoundForUpdate(db, round.id);
  if (!locked || locked.status !== 'revealed') {
    throw new VoteActionError(
      VOTE_ERROR_CODES.ROUND_NOT_REVEALED,
      'round chưa lật bài, hãy chọn thẻ như bình thường',
    );
  }
  return locked;
}

/**
 * Re-reads the room and refuses anybody who is not its host (FR-5, FR-7).
 *
 * The room is loaded again rather than taken from the handshake snapshot: `host_participant_id`
 * is written when the room is created, but a room the socket connected to minutes ago is not
 * evidence of who hosts it now.
 */
export async function requireHost(
  db: Queryable,
  roomId: string,
  participant: Participant,
): Promise<Room> {
  const room = await findRoomById(db, roomId);
  if (!room) {
    throw new VoteActionError(VOTE_ERROR_CODES.NO_ROUND, 'phòng không còn tồn tại');
  }
  if (!isRoomHost(room, participant)) {
    throw new VoteActionError(
      VOTE_ERROR_CODES.NOT_HOST,
      'chỉ host mới thực hiện được thao tác này',
    );
  }
  return room;
}

/**
 * Casts or changes a vote (FR-4).
 *
 * Changing one's mind is the same call: `castVote` upserts on (round_id, participant_id), so a
 * second card replaces the first rather than adding a ballot, and the room sees the same
 * value-free `vote:cast` either way.
 *
 * The open-round check and the insert run on one locked client via `withTransaction`, closing
 * the gap a plain check-then-act would leave: without the lock, a `round:reveal` landing between
 * the two could commit a vote into a round the room has already seen revealed.
 */
export async function handleVoteCast(
  pool: pg.Pool,
  io: RealtimeServer,
  context: { room: Room; participant: Participant },
  payload: unknown,
): Promise<void> {
  const value = readVoteRequest(payload);

  await withTransaction(pool, async (client) => {
    const round = await requireOpenRound(client, context.room.id);
    await castVote(client, {
      roundId: round.id,
      participantId: context.participant.id,
      deckType: context.room.deckType,
      value,
    });
  });
  await touchRoom(pool, context.room.id);

  emitVoteCast(io, context.room.code, context.participant.id);
}

/**
 * Changes one's own card after the reveal, leaving evidence that it changed (issue #11).
 *
 * Three properties, in the order they matter:
 *
 * 1. **Only your own card moves.** `context.participant` comes from the handshake and the payload
 *    carries no id, so there is nothing here to forge — the same construction that keeps
 *    `vote:cast` honest. A seat that never voted has nothing to edit and is refused.
 * 2. **The change is visible.** `editRevealedVote` writes the old card and a timestamp beside the
 *    new one, and the broadcast is rebuilt from those rows, so every screen in the room learns
 *    what the card was as well as what it is now.
 * 3. **The numbers follow the cards.** The tally is recomputed from the round's votes as they now
 *    stand, in the same transaction that changed one of them, so no client can end up holding an
 *    average that belongs to a set of cards it is no longer showing.
 *
 * Re-picking the card you already show is a no-op rather than an edit: `editRevealedVote` returns
 * null, and the room is told nothing.
 */
export async function handleVoteEdit(
  pool: pg.Pool,
  io: RealtimeServer,
  context: { room: Room; participant: Participant },
  payload: unknown,
): Promise<void> {
  const value = readVoteRequest(payload);

  const changed = await withTransaction(pool, async (client) => {
    const round = await requireRevealedRound(client, context.room.id);

    const mine = await findVoteForParticipant(client, round.id, context.participant.id);
    if (!mine) {
      throw new VoteActionError(
        VOTE_ERROR_CODES.NO_VOTE,
        'bạn chưa vote ở round này nên không có bài để sửa',
      );
    }

    const edited = await editRevealedVote(client, {
      roundId: round.id,
      participantId: context.participant.id,
      deckType: context.room.deckType,
      value,
    });
    if (!edited) return null;

    return { round, votes: await listVotesForRound(client, round.id) };
  });

  if (!changed) return;

  await touchRoom(pool, context.room.id);

  const state = toRoundStateDto(changed.round, changed.votes, context.room.deckType);
  emitVoteEdited(io, context.room.code, {
    participantId: context.participant.id,
    round: state.round as NonNullable<typeof state.round>,
    votes: state.votes,
    tally: state.tally as NonNullable<typeof state.tally>,
  });
}

/**
 * Turns every card over at once (FR-5, FR-6).
 *
 * `revealRound` only matches a round still in `voting`, so a double-click cannot move
 * `revealed_at`; the broadcast is rebuilt from the round as it stands either way, which makes a
 * repeat click a harmless re-announcement rather than a second, differently-timestamped reveal.
 * When `revealRound` finds nothing to flip — a concurrent reveal already won the race — the
 * round's actual row is re-read rather than trusting the pre-race `current` snapshot, so that
 * race resolves as the same harmless re-announcement instead of a spurious refusal.
 */
export async function handleRoundReveal(
  pool: pg.Pool,
  io: RealtimeServer,
  context: { room: Room; participant: Participant },
): Promise<void> {
  const room = await requireHost(pool, context.room.id, context.participant);

  const current = await findCurrentRound(pool, room.id);
  if (!current) {
    throw new VoteActionError(VOTE_ERROR_CODES.NO_ROUND, 'phòng chưa có round nào để lật bài');
  }

  const revealed = (await revealRound(pool, current.id)) ?? (await findRoundById(pool, current.id));
  if (!revealed || revealed.status !== 'revealed') {
    throw new VoteActionError(VOTE_ERROR_CODES.ROUND_NOT_OPEN, 'round không thể lật bài');
  }

  const votes = await listVotesForRound(pool, revealed.id);
  const state = toRoundStateDto(revealed, votes, room.deckType);
  await touchRoom(pool, room.id);

  // `state.round` and `state.tally` are non-null for a revealed round by construction; the
  // assertions keep that fact local instead of widening the broadcast payload's type.
  emitRoundRevealed(io, room.code, {
    round: state.round as NonNullable<typeof state.round>,
    votes: state.votes,
    tally: state.tally as NonNullable<typeof state.tally>,
  });
}

/**
 * Starts the next round (FR-7).
 *
 * PRD §4 distinguishes "Vote lại" (step 7, same item) from "Task tiếp theo / Round mới"
 * (step 8, next item), but §8 lists a single `round:reset` event and §7 a single
 * "Mỗi lần 'Round mới' tạo 1 record". Both buttons therefore land here: the backend behaviour
 * — a fresh `voting_rounds` row with the next `round_number` and status `voting` — is identical,
 * and only the label the user reads differs. The old round keeps its votes, so nothing from it
 * can leak into the new tally: every read is scoped to the current round's id.
 */
export async function handleRoundReset(
  pool: pg.Pool,
  io: RealtimeServer,
  context: { room: Room; participant: Participant },
): Promise<void> {
  const room = await requireHost(pool, context.room.id, context.participant);

  const round = await createRound(pool, room.id);
  await touchRoom(pool, room.id);

  emitRoundReset(io, room.code, { round: toRoundDto(round) });
}

/** Wires the four client→server actions onto one connected socket. */
export function registerVotingHandlers(
  io: RealtimeServer,
  pool: pg.Pool,
  socket: Socket,
  context: { room: Room; participant: Participant },
): void {
  const run = (action: () => Promise<void>, ack: AckFn | undefined): void => {
    action().then(
      () => respond(ack, ackOk()),
      (error: unknown) => {
        const result = ackFor(error);
        if (result.ok === false && result.code === VOTE_ERROR_CODES.INTERNAL) {
          console.error('realtime: voting action failed', error);
        }
        respond(ack, result);
      },
    );
  };

  socket.on(SOCKET_EVENTS.VOTE_CAST, (payload: unknown, ack?: AckFn) => {
    run(() => handleVoteCast(pool, io, context, payload), ack);
  });

  socket.on(SOCKET_EVENTS.VOTE_EDIT, (payload: unknown, ack?: AckFn) => {
    run(() => handleVoteEdit(pool, io, context, payload), ack);
  });

  socket.on(SOCKET_EVENTS.ROUND_REVEAL, (ack?: AckFn) => {
    run(() => handleRoundReveal(pool, io, context), ack);
  });

  socket.on(SOCKET_EVENTS.ROUND_RESET, (ack?: AckFn) => {
    run(() => handleRoundReset(pool, io, context), ack);
  });
}
