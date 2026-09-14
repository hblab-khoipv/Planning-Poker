import { describe, expect, it } from 'vitest';
import { BCRYPT_COST, BCRYPT_HASH_PATTERN, hashPassword, verifyPassword } from './password';

/** Tests hash at cost 4 — the algorithm is the library's, the cost only changes how long it takes. */
const TEST_COST = 4;

describe('hashPassword', () => {
  it('produces a bcrypt modular-crypt hash, never the password itself', async () => {
    const hash = await hashPassword('poker-night-42', TEST_COST);

    expect(hash).toMatch(BCRYPT_HASH_PATTERN);
    expect(hash).not.toContain('poker-night-42');
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([
      hashPassword('poker-night-42', TEST_COST),
      hashPassword('poker-night-42', TEST_COST),
    ]);

    expect(first).not.toBe(second);
    await expect(verifyPassword('poker-night-42', first)).resolves.toBe(true);
    await expect(verifyPassword('poker-night-42', second)).resolves.toBe(true);
  });

  it('encodes the cost into the hash', async () => {
    expect(await hashPassword('poker-night-42', TEST_COST)).toContain(`$0${TEST_COST}$`);
  });

  it('defaults to a cost that is deliberately slow', () => {
    expect(BCRYPT_COST).toBeGreaterThanOrEqual(12);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    const hash = await hashPassword('poker-night-42', TEST_COST);

    await expect(verifyPassword('poker-night-42', hash)).resolves.toBe(true);
  });

  it.each([
    ['wrong password', 'poker-night-43'],
    ['empty password', ''],
    ['case flipped', 'Poker-Night-42'],
    ['trailing space', 'poker-night-42 '],
  ])('rejects %s', async (_label, attempt) => {
    const hash = await hashPassword('poker-night-42', TEST_COST);

    await expect(verifyPassword(attempt, hash)).resolves.toBe(false);
  });

  it('returns false for an account with no password instead of throwing', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
  });

  it('rejects a corrupt stored hash rather than treating it as a match', async () => {
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });

  it('verifies a unicode password byte-for-byte', async () => {
    const password = 'mật-khẩu-☕-42';
    const hash = await hashPassword(password, TEST_COST);

    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword('mật-khẩu-☕-43', hash)).resolves.toBe(false);
  });
});
