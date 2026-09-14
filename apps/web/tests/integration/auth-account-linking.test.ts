import { randomUUID } from 'node:crypto';
import type { Adapter, AdapterSession } from 'next-auth/adapters';
import type { NextAuthOptions } from 'next-auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool } from '@/server/db/pool';
import { registerUser } from '@/server/auth/credentials';
import { truncateAuthTables } from '../helpers/db';
import {
  type CallbackHandler,
  type CallbackHandlerParams,
  internalProvider,
  loadCallbackHandler,
} from '../helpers/next-auth-internals';

/**
 * The gate from issue #2: prove that account linking and session creation really work against
 * task 2's uuid `users` schema, not just that we believe they do.
 *
 * A user registers with email + password, then signs in with Google using the same address.
 * Both must resolve to the same `users.id`, with one `accounts` row per provider.
 *
 * Google's own servers are not involved — an OAuth round-trip cannot run offline — but the code
 * that decides "same person or new person" is not ours to mock: it is NextAuth's own
 * `callbackHandler`, the exact function its /api/auth/callback/:provider route calls once a
 * provider has verified the user. We hand it our real `authOptions` adapter and the real
 * provider config, against the real database, so what is simulated is Google's answer — not our
 * handling of it.
 */

const CREDENTIALS_EMAIL = 'khoi.pv@hblab.vn';
const CREDENTIALS_PASSWORD = 'planning-poker-42';

function googleAccount(providerAccountId: string): Record<string, unknown> {
  return {
    provider: 'google',
    type: 'oauth',
    providerAccountId,
    access_token: 'ya29.fake-access-token',
    id_token: 'fake.id.token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    scope: 'openid email profile',
    token_type: 'bearer',
  };
}

describe('NextAuth account linking against the uuid users schema', () => {
  let authOptions: NextAuthOptions;
  let adapter: Adapter;
  let googleProvider: Record<string, unknown>;
  let callbackHandler: CallbackHandler;

  beforeAll(async () => {
    // Google is only configured when its credentials are present, so they must be set before
    // `authOptions` is first evaluated.
    process.env.GOOGLE_CLIENT_ID ||= 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET ||= 'test-google-client-secret';
    process.env.NEXTAUTH_SECRET ||= 'test-nextauth-secret';

    ({ authOptions } = await import('@/server/auth/options'));

    if (!authOptions.adapter) throw new Error('authOptions has no adapter');
    adapter = authOptions.adapter;

    googleProvider = internalProvider(authOptions, 'google');

    callbackHandler = loadCallbackHandler();
  });

  beforeEach(async () => {
    await truncateAuthTables(getPool());
  });

  afterAll(async () => {
    await closePool();
  });

  async function registerCredentialsUser(email = CREDENTIALS_EMAIL): Promise<string> {
    const result = await registerUser({
      email,
      password: CREDENTIALS_PASSWORD,
      displayName: 'Khôi',
    });
    if (!result.ok) throw new Error(`registration failed: ${result.errors.join(', ')}`);
    return result.user.id;
  }

  function signInWithGoogle(
    profile: { email: string; name?: string; image?: string },
    providerAccountId: string,
    session: CallbackHandlerParams['options']['session'] = { strategy: 'jwt' },
    provider: Record<string, unknown> = googleProvider,
  ) {
    return callbackHandler({
      profile,
      account: googleAccount(providerAccountId),
      options: { adapter, jwt: {}, events: {}, session, provider },
    });
  }

  it('links a Google sign-in onto the account created with email + password', async () => {
    const userId = await registerCredentialsUser();

    const result = await signInWithGoogle(
      { email: CREDENTIALS_EMAIL, name: 'Khoi Pham', image: 'https://example.test/a.png' },
      'google-account-1',
    );

    // The whole point: one person, one users row, whichever button they pressed.
    expect(result.user.id).toBe(userId);

    const { rows: users } = await getPool().query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users WHERE email = $1',
      [CREDENTIALS_EMAIL],
    );
    expect(users[0]?.count).toBe('1');

    const { rows: accounts } = await getPool().query<{
      provider: string;
      userId: string;
      providerAccountId: string;
    }>('SELECT provider, "userId", "providerAccountId" FROM accounts ORDER BY provider');

    expect(accounts).toHaveLength(2);
    expect(accounts.map((row) => row.provider)).toEqual(['credentials', 'google']);
    expect(new Set(accounts.map((row) => row.userId))).toEqual(new Set([userId]));
    expect(accounts.find((row) => row.provider === 'google')?.providerAccountId).toBe(
      'google-account-1',
    );
  });

  it('keeps returning the same user on later Google sign-ins without relinking', async () => {
    const userId = await registerCredentialsUser();
    await signInWithGoogle({ email: CREDENTIALS_EMAIL }, 'google-account-1');

    const second = await signInWithGoogle({ email: CREDENTIALS_EMAIL }, 'google-account-1');

    expect(second.user.id).toBe(userId);
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM accounts WHERE provider = 'google'`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('refuses to link by email when the provider does not allow it', async () => {
    await registerCredentialsUser();

    // Same flow, same schema — only the flag our authOptions sets is taken away. Proves the
    // linking above comes from that decision and not from some accident of the adapter.
    await expect(
      signInWithGoogle(
        { email: CREDENTIALS_EMAIL },
        'google-account-1',
        { strategy: 'jwt' },
        {
          ...googleProvider,
          allowDangerousEmailAccountLinking: false,
        },
      ),
    ).rejects.toThrow(/same e-mail|not linked/i);
  });

  it('creates a separate user for a Google account with a different email', async () => {
    const userId = await registerCredentialsUser();

    const other = await signInWithGoogle({ email: 'someone.else@hblab.vn' }, 'google-account-2');

    expect(other.user.id).not.toBe(userId);
    expect(other.isNewUser).toBe(true);

    const { rows } = await getPool().query<{ count: string }>(
      'SELECT count(*)::text AS count FROM users',
    );
    expect(rows[0]?.count).toBe('2');
  });

  it('creates and reads back a database session keyed by the uuid user id', async () => {
    const userId = await registerCredentialsUser();

    // Session rows are what the adapter docs' integer-id example would have produced; this is
    // the other half of issue #2's gate — uuid ids round-trip through sessions as well.
    const result = await signInWithGoogle({ email: CREDENTIALS_EMAIL }, 'google-account-1', {
      strategy: 'database',
      generateSessionToken: () => randomUUID(),
      maxAge: 60 * 60 * 24,
    });

    expect(result.user.id).toBe(userId);
    const sessionToken = (result.session as AdapterSession).sessionToken;
    expect(sessionToken).toBeTruthy();

    const loaded = await adapter.getSessionAndUser?.(sessionToken);
    expect(loaded?.user.id).toBe(userId);
    expect(loaded?.session.userId).toBe(userId);
    expect(typeof loaded?.user.id).toBe('string');

    await adapter.deleteSession?.(sessionToken);
    expect(await adapter.getSessionAndUser?.(sessionToken)).toBeNull();
  });

  it('refuses a Google profile whose email is not verified', async () => {
    await registerCredentialsUser();

    // The signIn callback runs before the linking handler in NextAuth's callback route, so this
    // is the guard that keeps ALLOW_GOOGLE_EMAIL_LINKING from being a takeover route.
    const allowed = await authOptions.callbacks?.signIn?.({
      user: { id: 'unused', email: CREDENTIALS_EMAIL },
      account: googleAccount('google-account-3') as never,
      profile: { email: CREDENTIALS_EMAIL, email_verified: false } as never,
    });
    expect(allowed).toBe(false);

    const verified = await authOptions.callbacks?.signIn?.({
      user: { id: 'unused', email: CREDENTIALS_EMAIL },
      account: googleAccount('google-account-3') as never,
      profile: { email: CREDENTIALS_EMAIL, email_verified: true } as never,
    });
    expect(verified).toBe(true);
  });

  it('cascades accounts and sessions when the user row goes away', async () => {
    const userId = await registerCredentialsUser();
    await signInWithGoogle({ email: CREDENTIALS_EMAIL }, 'google-account-1', {
      strategy: 'database',
      generateSessionToken: () => randomUUID(),
      maxAge: 60 * 60 * 24,
    });

    await getPool().query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await getPool().query<{ accounts: string; sessions: string }>(
      `SELECT (SELECT count(*)::text FROM accounts) AS accounts,
              (SELECT count(*)::text FROM sessions) AS sessions`,
    );
    expect(rows[0]).toEqual({ accounts: '0', sessions: '0' });
  });
});
