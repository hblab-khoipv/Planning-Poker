import type { DeckType } from '@planning-poker/shared';
import {
  addParticipant,
  castVote,
  createRoom,
  createRound,
  createUser,
  type Participant,
  type Queryable,
  type Room,
  type User,
  type VotingRound,
} from '../../src/db/repositories/index.js';

/**
 * Fixture helpers for tests that need a room to exist before they can assert anything.
 * Everything goes through the real repositories, so a fixture that stops compiling or
 * violating a constraint is a genuine signal, not test-only drift.
 */

/** Tables in dependency order — children first, so truncation never trips a foreign key. */
export const APP_TABLES = [
  'votes',
  'voting_rounds',
  'room_participants',
  'rooms',
  'accounts',
  'user_credentials',
  'sessions',
  'verification_token',
  'users',
] as const;

/**
 * Empties every application table. Integration tests share one database (vitest runs those
 * files serially), so each file starts from a known-empty schema rather than inheriting rows.
 */
export async function truncateAll(db: Queryable): Promise<void> {
  await db.query(`TRUNCATE TABLE ${APP_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

let emailCounter = 0;

export async function seedUser(
  db: Queryable,
  overrides: { email?: string; displayName?: string } = {},
): Promise<User> {
  emailCounter += 1;
  return createUser(db, {
    email: overrides.email ?? `seed-user-${emailCounter}@example.test`,
    displayName: overrides.displayName ?? `Seed User ${emailCounter}`,
  });
}

export async function seedRoom(
  db: Queryable,
  overrides: { name?: string; deckType?: DeckType; hostId?: string | null; code?: string } = {},
): Promise<Room> {
  return createRoom(db, {
    name: overrides.name ?? 'Sprint 42 refinement',
    deckType: overrides.deckType ?? 'fibonacci',
    hostId: overrides.hostId ?? null,
    ...(overrides.code === undefined ? {} : { code: overrides.code }),
  });
}

export async function seedGuest(
  db: Queryable,
  roomId: string,
  guestName = 'Guest',
): Promise<Participant> {
  return addParticipant(db, { roomId, guestName });
}

export interface SeededRoom {
  room: Room;
  participants: Participant[];
  round: VotingRound;
}

/**
 * The common starting point: a room with `guestCount` guests seated and round 1 open.
 * Pass `votes` to have each participant cast the value at the matching index.
 */
export async function seedRoomWithRound(
  db: Queryable,
  options: {
    guestCount?: number;
    deckType?: DeckType;
    hostId?: string | null;
    votes?: readonly string[];
  } = {},
): Promise<SeededRoom> {
  const deckType = options.deckType ?? 'fibonacci';
  const room = await seedRoom(db, { deckType, hostId: options.hostId ?? null });

  const guestCount = options.guestCount ?? 3;
  const participants: Participant[] = [];
  for (let i = 0; i < guestCount; i += 1) {
    participants.push(await seedGuest(db, room.id, `Guest ${i + 1}`));
  }

  const round = await createRound(db, room.id);

  for (const [index, value] of (options.votes ?? []).entries()) {
    const participant = participants[index];
    if (!participant) {
      throw new Error(`seedRoomWithRound: ${options.votes?.length} votes but ${guestCount} guests`);
    }
    await castVote(db, {
      roundId: round.id,
      participantId: participant.id,
      deckType,
      value,
    });
  }

  return { room, participants, round };
}
