/**
 * Thrown emoji reactions — the room's applause track.
 *
 * A reaction is deliberately the lightest thing in the product: it is never written down, it has
 * no bearing on a round, and it can be sent in any round state. That is what keeps it from
 * disturbing voting (FR-4 onwards) — there is no state here for a reveal to race with.
 *
 * Both halves of the rule live here rather than in the server alone, so the palette a browser
 * renders and the palette the server accepts cannot drift: the client shows exactly the emoji it
 * is allowed to send, and the server still checks, because a browser's opinion is not
 * authoritative.
 */

export interface ReactionOption {
  emoji: string;
  /** Vietnamese label — the button's accessible name, since an emoji alone reads as nothing. */
  label: string;
}

/**
 * The palette. Small on purpose: a wall of emoji turns a two-second bit of fun into a decision,
 * and every extra one is another thing the server has to accept forever.
 */
export const REACTION_OPTIONS: readonly ReactionOption[] = [
  { emoji: '👍', label: 'Đồng ý' },
  { emoji: '🎉', label: 'Ăn mừng' },
  { emoji: '😂', label: 'Cười' },
  { emoji: '❤️', label: 'Thích' },
  { emoji: '🤔', label: 'Suy nghĩ' },
  { emoji: '☕', label: 'Giải lao' },
  { emoji: '🔥', label: 'Cháy' },
  { emoji: '🍅', label: 'Ném cà chua' },
  { emoji: '📄', label: 'Ném tài liệu' },
] as const;

export const REACTION_EMOJIS: readonly string[] = REACTION_OPTIONS.map((option) => option.emoji);

/** Server-side gate and client-side render list in one predicate (see the module comment). */
export function isAllowedReaction(value: unknown): value is string {
  return typeof value === 'string' && REACTION_EMOJIS.includes(value);
}

/**
 * How fast one seat may throw.
 *
 * A sliding window rather than a fixed one: a fixed window lets somebody send twice the budget
 * across a boundary, which for an animation that lands on everybody's screen is exactly the
 * burst worth preventing. The numbers allow drumming a card in genuine excitement — five in
 * three seconds — and nothing beyond that.
 */
export const REACTION_RATE_LIMIT = { maxPerWindow: 5, windowMs: 3000 } as const;

/** How long a thrown emoji stays on screen. Shared so the server's ids and the client's
 * pruning agree on what "still in flight" means. */
export const REACTION_TTL_MS = 2500;

/**
 * Client→server: throw one emoji.
 *
 * `targetParticipantId` is who it is aimed at, or null/absent for the table. There is no field
 * for who is throwing — that is the sender's own handshake, exactly as it is for `vote:cast`, so
 * no browser can attribute a reaction to somebody else.
 */
export interface ReactionThrowRequest {
  emoji: string;
  targetParticipantId?: string | null;
}

/** Server→client: somebody threw one. Ephemeral — no client is expected to keep it. */
export interface ReactionThrownPayload {
  /** Server-minted, unique per throw, so a client can key and expire each one independently. */
  id: string;
  emoji: string;
  fromParticipantId: string;
  /** The seat it flies to, or null when it was thrown at the table. */
  targetParticipantId: string | null;
  /** Server clock, milliseconds. Only ever used for ordering and expiry. */
  thrownAt: number;
}
