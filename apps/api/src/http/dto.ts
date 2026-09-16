import type {
  ParticipantDto,
  RevealedVoteDto,
  RoomDto,
  RoundDto,
  RoundStateDto,
  RoundTally,
} from '@planning-poker/shared';
import { tallyVotes } from '@planning-poker/shared';
import type { Participant, Room, Vote, VotingRound } from '../db/repositories/index.js';
import type { ParticipantWithUser } from '../db/repositories/participants.js';
import { isRoomHost } from './authority.js';

/** Row shapes are internal; these are the only things that go over the wire. */

export function toRoomDto(room: Room): RoomDto {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    deckType: room.deckType,
    hostId: room.hostId,
    hostParticipantId: room.hostParticipantId,
    createdAt: room.createdAt.toISOString(),
  };
}

/** Shown when a seat somehow has neither a per-room name nor an account name. */
export const FALLBACK_DISPLAY_NAME = 'Khách';

/**
 * A per-room name always wins: PRD §3.1.2 lets a signed-in member rename themselves for one
 * room without touching their account.
 */
export function participantDisplayName(guestName: string | null, userName: string | null): string {
  return guestName ?? userName ?? FALLBACK_DISPLAY_NAME;
}

export function toParticipantDto(
  participant: Participant | ParticipantWithUser,
  options: { userName?: string | null; hostId: string | null; hostParticipantId?: string | null },
): ParticipantDto {
  const userName = 'userName' in participant ? participant.userName : (options.userName ?? null);

  return {
    id: participant.id,
    displayName: participantDisplayName(participant.guestName, userName),
    isGuest: participant.userId === null,
    // The same predicate that gates reveal and reset, so the Host badge and the permission
    // can never disagree — including in a guest-hosted room, where hostId is NULL.
    isHost: isRoomHost(
      { hostId: options.hostId, hostParticipantId: options.hostParticipantId ?? null },
      participant,
    ),
    isOnline: participant.isOnline,
    joinedAt: participant.joinedAt.toISOString(),
  };
}

export function toRoundDto(round: VotingRound): RoundDto {
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    status: round.status,
    createdAt: round.createdAt.toISOString(),
    revealedAt: round.revealedAt?.toISOString() ?? null,
  };
}

/**
 * A card, plus the evidence that it replaced an earlier one (issue #11).
 *
 * The edit fields ride on the same object as the value and are built in the same place, so a
 * revealed payload cannot carry a card while dropping the fact that the room already saw a
 * different one. Like the value itself, they only ever leave the server through
 * `toRoundStateDto`, which refuses to emit any of it for a round that is not `revealed`.
 */
export function toRevealedVoteDto(vote: Vote): RevealedVoteDto {
  return {
    participantId: vote.participantId,
    value: vote.value,
    originalValue: vote.originalValue,
    editedAt: vote.editedAt?.toISOString() ?? null,
  };
}

/**
 * Builds what a client is allowed to know about a round — the single choke point for FR-4.
 *
 * The `votes` argument is every vote in the round, values included, because the caller has to
 * read them to know who has voted at all. What leaves this function depends entirely on
 * `round.status`: while it is `voting`, the values are reduced to the participant ids that cast
 * them and the tally is null, so no caller can forward a value early even by accident. Only a
 * round the database itself records as `revealed` produces a payload with cards in it.
 *
 * Everything that publishes round state goes through here: the socket snapshot, the reveal
 * broadcast and `GET /rooms/:code/round`.
 */
export function toRoundStateDto(
  round: VotingRound | null,
  votes: readonly Vote[],
  deckType: Room['deckType'],
): RoundStateDto {
  if (!round) {
    return { round: null, votedParticipantIds: [], votes: [], tally: null };
  }

  const votedParticipantIds = votes.map((vote) => vote.participantId);

  if (round.status !== 'revealed') {
    return { round: toRoundDto(round), votedParticipantIds, votes: [], tally: null };
  }

  return {
    round: toRoundDto(round),
    votedParticipantIds,
    votes: votes.map(toRevealedVoteDto),
    tally: computeTally(deckType, votes),
  };
}

/** FR-6's numbers, from the shared implementation both ends agree on. */
export function computeTally(deckType: Room['deckType'], votes: readonly Vote[]): RoundTally {
  return tallyVotes(
    deckType,
    votes.map((vote) => vote.value),
  );
}
