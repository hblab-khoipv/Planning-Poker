import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@planning-poker/shared';
import { randomInt } from 'node:crypto';

/**
 * The alphabet, length and parsing rules live in `@planning-poker/shared` so the browser applies
 * exactly the same ones; only minting a code is server-side, because it needs a CSPRNG.
 */
export {
  isValidRoomCode,
  normalizeRoomCode,
  parseRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '@planning-poker/shared';

/**
 * A random room code. 32^8 ≈ 1.1e12 possibilities drawn from a CSPRNG, so codes are not
 * guessable or enumerable — the join link is the only way into a room (PRD §3.1.2, §10).
 */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
