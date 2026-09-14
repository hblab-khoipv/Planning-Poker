import type { DeckType, RoundStatus } from '@planning-poker/shared';
import type pg from 'pg';

/**
 * Anything the repositories can run a query on: the pool, or a single checked-out client when
 * the caller needs several writes inside one transaction. Repositories never open or commit
 * transactions themselves — that decision belongs to the caller.
 */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/** A user row. `displayName` is the adapter's `users.name` column (see 0002 migration). */
export interface User {
  id: string;
  displayName: string | null;
  email: string | null;
  image: string | null;
  createdAt: Date;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  deckType: DeckType;
  /** The host's account, or null when a guest created the room. */
  hostId: string | null;
  /** The host's seat (migration 0004) — the half of host authority a guest host has. */
  hostParticipantId: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface Participant {
  id: string;
  roomId: string;
  userId: string | null;
  guestName: string | null;
  joinedAt: Date;
  isOnline: boolean;
}

export interface VotingRound {
  id: string;
  roomId: string;
  roundNumber: number;
  status: RoundStatus;
  createdAt: Date;
  revealedAt: Date | null;
}

export interface Vote {
  id: string;
  roundId: string;
  participantId: string;
  value: string;
  votedAt: Date;
}

/** Raised when an argument is rejected before any SQL is sent. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Raised when a uniqueness rule the database enforces is violated. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Postgres unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || candidate.constraint === constraint;
}
