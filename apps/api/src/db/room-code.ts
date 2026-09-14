import { randomInt } from 'node:crypto';

/**
 * Crockford base32 minus I, L, O and U: no glyph pairs a human can confuse when reading a
 * room code aloud or copying it off a screen, and no accidental profanity from the vowels.
 */
const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ROOM_CODE_LENGTH = 8;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * A random room code. 32^8 ≈ 1.1e12 possibilities drawn from a CSPRNG, so codes are not
 * guessable or enumerable — the join link is the only way into a room (PRD §3.1.2).
 */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

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
