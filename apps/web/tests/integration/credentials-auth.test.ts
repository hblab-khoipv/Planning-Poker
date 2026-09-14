import type { NextAuthOptions } from 'next-auth';
import type { RequestInternal, User } from 'next-auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BCRYPT_HASH_PATTERN } from '@/server/auth/password';
import { authenticateWithPassword, findUserByEmail, registerUser } from '@/server/auth/credentials';
import { closePool, getPool } from '@/server/db/pool';
import { truncateAuthTables } from '../helpers/db';
import { internalProvider } from '../helpers/next-auth-internals';

/**
 * Registration, login and session retrieval against the docker-compose Postgres — the real
 * schema, the real queries, no mocks.
 */

const EMAIL = 'khoi.pv@hblab.vn';
const PASSWORD = 'planning-poker-42';

describe('credentials auth against Postgres', () => {
  let authOptions: NextAuthOptions;

  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET ||= 'test-nextauth-secret';
    ({ authOptions } = await import('@/server/auth/options'));
  });

  beforeEach(async () => {
    await truncateAuthTables(getPool());
  });

  afterAll(async () => {
    await closePool();
  });

  /**
   * Calls `authorize` exactly as NextAuth would: on the provider *after* it has merged in the
   * options we passed to `CredentialsProvider(...)` (see tests/helpers/next-auth-internals).
   */
  async function authorize(email: string, password: string): Promise<User | null> {
    const provider = internalProvider(authOptions, 'credentials');
    const authorizeFn = provider.authorize as (
      credentials: Record<string, string>,
      request: Pick<RequestInternal, 'body' | 'query' | 'headers' | 'method'>,
    ) => Promise<User | null>;

    return authorizeFn({ email, password }, { body: {}, query: {}, headers: {}, method: 'POST' });
  }

  describe('registration', () => {
    it('creates the user, the password row and a credentials account row', async () => {
      const result = await registerUser({ email: EMAIL, password: PASSWORD, displayName: 'Khôi' });

      expect(result.ok).toBe(true);
      const userId = result.ok ? result.user.id : '';
      expect(userId).toMatch(/^[0-9a-f-]{36}$/);

      const { rows } = await getPool().query<{
        name: string | null;
        email: string;
        password_hash: string;
        provider: string;
      }>(
        `SELECT u.name, u.email, c.password_hash, a.provider
           FROM users u
           JOIN user_credentials c ON c.user_id = u.id
           JOIN accounts a ON a."userId" = u.id
          WHERE u.id = $1`,
        [userId],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe(EMAIL);
      expect(rows[0]?.name).toBe('Khôi');
      expect(rows[0]?.provider).toBe('credentials');
    });

    it('stores a bcrypt hash and never the password itself', async () => {
      await registerUser({ email: EMAIL, password: PASSWORD });

      const { rows } = await getPool().query<{ password_hash: string }>(
        'SELECT password_hash FROM user_credentials',
      );

      expect(rows[0]?.password_hash).toMatch(BCRYPT_HASH_PATTERN);
      expect(rows[0]?.password_hash).not.toContain(PASSWORD);
    });

    it('lower-cases the address so one person cannot hold two accounts', async () => {
      await registerUser({ email: 'Khoi.PV@HBLab.VN', password: PASSWORD });

      expect(await findUserByEmail(getPool(), EMAIL)).not.toBeNull();

      const duplicate = await registerUser({ email: EMAIL, password: PASSWORD });
      expect(duplicate).toMatchObject({ ok: false, status: 409 });
    });

    it('leaves no half-written user behind when the email is taken', async () => {
      await registerUser({ email: EMAIL, password: PASSWORD });

      const duplicate = await registerUser({ email: EMAIL, password: 'another-password-1' });

      expect(duplicate.ok).toBe(false);
      const { rows } = await getPool().query<{ users: string; credentials: string }>(
        `SELECT (SELECT count(*)::text FROM users) AS users,
                (SELECT count(*)::text FROM user_credentials) AS credentials`,
      );
      expect(rows[0]).toEqual({ users: '1', credentials: '1' });
    });

    it('rejects invalid input before touching the database', async () => {
      const result = await registerUser({ email: 'not-an-email', password: 'short' });

      expect(result).toMatchObject({ ok: false, status: 400 });
      const { rows } = await getPool().query<{ count: string }>(
        'SELECT count(*)::text AS count FROM users',
      );
      expect(rows[0]?.count).toBe('0');
    });
  });

  describe('login', () => {
    it('returns the user for the right password, through the real provider', async () => {
      const registered = await registerUser({
        email: EMAIL,
        password: PASSWORD,
        displayName: 'Khôi',
      });
      const userId = registered.ok ? registered.user.id : '';

      const user = await authorize(EMAIL, PASSWORD);

      expect(user).toMatchObject({ id: userId, email: EMAIL, name: 'Khôi' });
    });

    it('accepts the address in any case', async () => {
      await registerUser({ email: EMAIL, password: PASSWORD });

      await expect(authorize('KHOI.PV@HBLab.vn', PASSWORD)).resolves.not.toBeNull();
    });

    it.each([
      ['a wrong password', EMAIL, 'wrong-password-99'],
      ['an unknown email', 'nobody@hblab.vn', PASSWORD],
      ['an empty password', EMAIL, ''],
    ])('returns null for %s', async (_label, email, password) => {
      await registerUser({ email: EMAIL, password: PASSWORD });

      await expect(authorize(email, password)).resolves.toBeNull();
    });

    it('returns null for a user who has no password (Google-only account)', async () => {
      // What `@auth/pg-adapter` writes for an OAuth-only sign-up: a users row, no credentials row.
      const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO users (name, email) VALUES ('Google Only', $1) RETURNING id`,
        ['google.only@hblab.vn'],
      );
      expect(rows[0]?.id).toBeTruthy();

      await expect(
        authenticateWithPassword(getPool(), 'google.only@hblab.vn', PASSWORD),
      ).resolves.toBeNull();
    });
  });

  describe('session retrieval', () => {
    it('carries the user id from the JWT into the session object', async () => {
      const registered = await registerUser({
        email: EMAIL,
        password: PASSWORD,
        displayName: 'Khôi',
      });
      const userId = registered.ok ? registered.user.id : '';

      const user = await authorize(EMAIL, PASSWORD);
      expect(user).not.toBeNull();

      // The two callbacks NextAuth runs for a jwt-strategy session, in order.
      const token = await authOptions.callbacks?.jwt?.({
        token: {},
        user: user!,
        account: null,
        trigger: 'signIn',
      });
      expect(token?.sub).toBe(userId);

      const session = await authOptions.callbacks?.session?.({
        session: { user: { email: EMAIL, name: 'Khôi' }, expires: '2099-01-01T00:00:00.000Z' },
        token: token!,
        user: user as never,
        newSession: undefined,
        trigger: 'update',
      });

      expect((session?.user as { id?: string } | undefined)?.id).toBe(userId);
    });

    it('uses jwt sessions, which is what the Credentials provider requires', () => {
      expect(authOptions.session?.strategy).toBe('jwt');
    });
  });
});
