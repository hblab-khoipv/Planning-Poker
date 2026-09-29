import { randomUUID } from 'node:crypto';
import {
  type AckFn,
  isAllowedReaction,
  REACTION_RATE_LIMIT,
  type ReactionThrownPayload,
  type ReactionThrowRequest,
  SOCKET_EVENTS,
  VOTE_ERROR_CODES,
} from '@planning-poker/shared';
import type pg from 'pg';
import type { Socket } from 'socket.io';
import { findParticipantInRoom } from '../db/repositories/participants.js';
import type { Participant, Queryable, Room } from '../db/repositories/types.js';
import { emitReactionThrown, type RealtimeServer } from './channel.js';
import { ackFor, ackOk, VoteActionError } from './voting.js';

/**
 * Throwing an emoji at the table, or at somebody's seat.
 *
 * Three properties, in the order they matter:
 *
 * 1. **It cannot disturb voting.** Nothing here reads or writes a round, a vote or the room row,
 *    so a reaction is accepted identically whether the cards are down, up or being reset, and
 *    there is no state for a concurrent reveal to race with. It is not activity for the idle
 *    sweep either (`jobs/room-cleanup.ts`): cheering in an abandoned room should not keep it.
 * 2. **Nothing is persisted.** The payload is minted and broadcast; no table has a row for it.
 *    A client that was not connected simply never sees it, which is the whole contract.
 * 3. **Who threw it is not a parameter.** Like `vote:cast`, the sender comes from the handshake,
 *    so a browser cannot put somebody else's name on a tomato.
 *
 * The emoji is checked against `@planning-poker/shared`'s palette — the same list the client
 * renders — and the throw rate is capped per seat, because an animation that lands on every
 * screen in the room is worth rationing.
 */

/** Looking a target seat up inside the room, as an interface so the rules test without Postgres. */
export type SeatLookup = (roomId: string, participantId: string) => Promise<Participant | null>;

export function postgresSeatLookup(db: Queryable): SeatLookup {
  return (roomId, participantId) => findParticipantInRoom(db, roomId, participantId);
}

/** What a well-formed `reaction:throw` means, once its shape is known to be sound. */
export interface ReactionRequest {
  emoji: string;
  targetParticipantId: string | null;
}

/**
 * Reads and validates a throw. Everything off a socket is attacker-controlled, so the emoji is
 * matched against the palette rather than merely checked for being a string: without that, the
 * event would relay arbitrary text to every screen in the room.
 */
export function readReactionRequest(payload: unknown): ReactionRequest {
  const request = (payload ?? {}) as Partial<ReactionThrowRequest>;

  if (!isAllowedReaction(request.emoji)) {
    throw new VoteActionError(VOTE_ERROR_CODES.INVALID_EMOJI, 'emoji không nằm trong bộ cho phép');
  }

  const target = request.targetParticipantId;
  if (target !== undefined && target !== null && typeof target !== 'string') {
    throw new VoteActionError(VOTE_ERROR_CODES.INVALID_TARGET, 'targetParticipantId không hợp lệ');
  }

  return {
    emoji: request.emoji,
    targetParticipantId: typeof target === 'string' && target.length > 0 ? target : null,
  };
}

export interface RateLimitOptions {
  maxPerWindow?: number;
  windowMs?: number;
  /** Injected by the tests so a window can pass without really waiting. */
  now?: () => number;
}

/**
 * A sliding-window throttle keyed by seat.
 *
 * Sliding rather than fixed because a fixed window lets twice the budget through across its
 * boundary, and a double burst of flying tomatoes is precisely what this exists to stop. Each
 * key keeps only the timestamps still inside the window, so an idle room costs nothing, and a
 * key whose last throw has aged out is dropped entirely rather than leaking for the life of the
 * process.
 */
export class ReactionRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: RateLimitOptions = {}) {
    this.maxPerWindow = options.maxPerWindow ?? REACTION_RATE_LIMIT.maxPerWindow;
    this.windowMs = options.windowMs ?? REACTION_RATE_LIMIT.windowMs;
    this.now = options.now ?? Date.now;
  }

  /** Records a throw and says whether it is allowed. A refused throw does not count against
   * the budget — otherwise holding the button down would extend its own ban indefinitely. */
  tryThrow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);

    if (recent.length >= this.maxPerWindow) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Forgets a seat, called when its last socket goes. */
  forget(key: string): void {
    this.hits.delete(key);
  }
}

export interface ReactionDeps {
  lookup: SeatLookup;
  limiter: ReactionRateLimiter;
  /** Overridable so a test can assert the payload rather than a random id and a wall clock. */
  mintId?: () => string;
  clock?: () => number;
}

/**
 * Validates one throw and relays it (see the module comment for why nothing else happens).
 *
 * The target is checked against the room's own seats, so a forged id cannot make an emoji land
 * on a participant of another room — or on nobody, leaving every client to guess what to do
 * with it.
 */
export async function handleReactionThrow(
  io: RealtimeServer,
  context: { room: Room; participant: Participant },
  payload: unknown,
  deps: ReactionDeps,
): Promise<void> {
  const request = readReactionRequest(payload);

  if (!deps.limiter.tryThrow(context.participant.id)) {
    throw new VoteActionError(VOTE_ERROR_CODES.RATE_LIMITED, 'bạn đang ném quá nhanh, chờ chút đã');
  }

  if (request.targetParticipantId) {
    const target = await deps.lookup(context.room.id, request.targetParticipantId);
    if (!target) {
      throw new VoteActionError(VOTE_ERROR_CODES.INVALID_TARGET, 'người nhận không ở trong phòng');
    }
  }

  const thrown: ReactionThrownPayload = {
    id: (deps.mintId ?? randomUUID)(),
    emoji: request.emoji,
    fromParticipantId: context.participant.id,
    targetParticipantId: request.targetParticipantId,
    thrownAt: (deps.clock ?? Date.now)(),
  };

  emitReactionThrown(io, context.room.code, thrown);
}

/** Wires `reaction:throw` onto one connected socket. */
export function registerReactionHandlers(
  io: RealtimeServer,
  pool: pg.Pool,
  socket: Socket,
  context: { room: Room; participant: Participant },
  deps: Omit<ReactionDeps, 'lookup'> & { lookup?: SeatLookup },
): void {
  const resolved: ReactionDeps = { lookup: postgresSeatLookup(pool), ...deps };

  socket.on(SOCKET_EVENTS.REACTION_THROW, (payload: unknown, ack?: AckFn) => {
    void handleReactionThrow(io, context, payload, resolved).then(
      () => ack?.(ackOk()),
      (error: unknown) => {
        const result = ackFor(error);
        if (result.ok === false && result.code === VOTE_ERROR_CODES.INTERNAL) {
          console.error('realtime: reaction throw failed', error);
        }
        ack?.(result);
      },
    );
  });
}
