import bcrypt from 'bcryptjs';

/**
 * Password hashing for the Credentials provider.
 *
 * bcrypt via `bcryptjs` — a well-known implementation, pure JavaScript so no native build step
 * is needed in CI or on the single EC2 host we deploy to. Nothing here is hand-rolled crypto:
 * salting, the cost parameter and the constant-time comparison are all the library's.
 */

/**
 * Work factor. 12 costs roughly a quarter second per hash on the target hardware — slow enough
 * to make offline cracking expensive, fast enough that a login is not noticeably delayed.
 */
export const BCRYPT_COST = 12;

/** Shape of a bcrypt modular-crypt hash, used to assert we never store a plaintext password. */
export const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * A pre-computed hash of a value nobody can log in with. `verifyPassword` compares against it
 * when the account has no password, so "unknown email" and "wrong password" take the same time
 * and the login form cannot be used to enumerate which emails are registered.
 */
const DUMMY_HASH = bcrypt.hashSync('planning-poker::no-such-account', 10);

export async function hashPassword(password: string, cost: number = BCRYPT_COST): Promise<string> {
  return bcrypt.hash(password, cost);
}

/**
 * Verifies a password against a stored hash. Pass `null` when the user exists but has no
 * credentials row (Google-only account) or does not exist at all: the answer is still `false`,
 * but it is reached by doing the same work.
 */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (hash === null) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }

  return bcrypt.compare(password, hash);
}
