import type { ParticipantDto } from '@planning-poker/shared';

/**
 * Where each person sits around the virtual table (issue #11).
 *
 * The room screen is a table seen from above, so somebody has to decide which seat each person
 * takes. That decision is here rather than in the component for the usual reason in this codebase:
 * it is a rule with edge cases — an empty room, a room with no host, more people than the table
 * has sides — and rules with edge cases are worth asserting directly instead of through a
 * rendered tree.
 *
 * Two properties hold for every arrangement:
 *
 * 1. **The host faces the room.** Issue #11 puts the host "chính diện", which here means the
 *    middle of the near edge — the one the reader is looking over. The middle, rather than merely
 *    somewhere along that edge, so the host does not drift sideways as the room fills up.
 * 2. **Nobody is seated twice or dropped.** The four edges are a partition of the participant
 *    list, which is what stops a seat from quietly disappearing when somebody joins.
 */

export interface TableSeating {
  top: ParticipantDto[];
  left: ParticipantDto[];
  right: ParticipantDto[];
  /** The near edge, host in the middle. */
  bottom: ParticipantDto[];
}

/**
 * How many seats each edge takes before the next one is used.
 *
 * The top edge fills first because two people facing the host reads as a table rather than as a
 * queue, and the sides take fewer because a card plus a name is wider than it is tall — the same
 * reason a real table seats more people along its length.
 */
const CAPACITY = { top: 4, left: 2, right: 2, bottom: 4 } as const;

const EDGE_ORDER = ['top', 'left', 'right', 'bottom'] as const;

/** Seats everybody, with the host in the middle of the near edge. */
export function arrangeSeats(participants: readonly ParticipantDto[]): TableSeating {
  const host = participants.find((participant) => participant.isHost) ?? null;
  const others = participants.filter((participant) => participant !== host);

  const seating: TableSeating = { top: [], left: [], right: [], bottom: [] };

  others.forEach((participant, index) => {
    seating[edgeFor(index)].push(participant);
  });

  if (host) {
    // Splitting the near edge around the host is what keeps "chính diện" literally true: with
    // two neighbours the host sits between them, with one they sit to that person's right, and
    // alone they are centred by the row itself.
    const middle = Math.ceil(seating.bottom.length / 2);
    seating.bottom = [...seating.bottom.slice(0, middle), host, ...seating.bottom.slice(middle)];
  }

  return seating;
}

/**
 * The edge seat number `index` belongs to.
 *
 * Edges fill in order until each is at capacity; anybody left over after that goes round the
 * table again, so a room far larger than a real planning session still renders as a table with
 * crowded edges rather than losing people off the bottom of the screen.
 */
function edgeFor(index: number): keyof TableSeating {
  let remaining = index;
  for (const edge of EDGE_ORDER) {
    if (remaining < CAPACITY[edge]) return edge;
    remaining -= CAPACITY[edge];
  }

  const capacity = EDGE_ORDER.reduce((sum, edge) => sum + CAPACITY[edge], 0);
  // Past the point where every edge is full, alternate between the two long edges: they are the
  // ones that can absorb another card without pushing the table off screen.
  return (index - capacity) % 2 === 0 ? 'top' : 'bottom';
}

/** How a seat's card should be drawn, which is the whole of issue #11's colour rule. */
export type SeatCardState =
  /** No card played yet — grey (issue #11: "chưa chọn thì bài màu xám"). */
  | 'waiting'
  /** A card is in, face down. Coloured, but the value is nobody's business yet (FR-4). */
  | 'voted'
  /** The cards are up: this one is face up with its value on it. */
  | 'revealed'
  /** The cards are up and this seat never played one. */
  | 'no-vote';

export function seatCardState(options: {
  hasVoted: boolean;
  isRevealed: boolean;
  hasRevealedValue: boolean;
}): SeatCardState {
  if (!options.isRevealed) return options.hasVoted ? 'voted' : 'waiting';
  return options.hasRevealedValue ? 'revealed' : 'no-vote';
}
