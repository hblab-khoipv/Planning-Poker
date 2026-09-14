/**
 * Room-code alphabet and parsing, shared because both ends handle codes people type: the API
 * resolves them to a room, and the browser wants to reject an obviously wrong one without a
 * round trip. Generation stays in `apps/api` — it needs a CSPRNG, and only the server mints
 * codes (PRD §10: a code must not be guessable or enumerable).
 */

/**
 * Crockford base32 minus I, L, O and U: no glyph pairs a human can confuse when reading a
 * room code aloud or copying it off a screen, and no accidental profanity from the vowels.
 */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ROOM_CODE_LENGTH = 8;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Canonicalises a user-typed code: trims, upper-cases, and maps the characters the alphabet
 * deliberately omits onto the ones they are mistaken for, so someone typing "hello1o" from a
 * chat message still lands in the right room.
 */
export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
}

export function isValidRoomCode(input: string): boolean {
  return ROOM_CODE_PATTERN.test(input);
}

/** Normalises first and returns null unless the result is a real code. */
export function parseRoomCode(input: string): string | null {
  const normalized = normalizeRoomCode(input);
  return isValidRoomCode(normalized) ? normalized : null;
}
