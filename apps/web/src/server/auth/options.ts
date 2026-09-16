import PostgresAdapter from '@auth/pg-adapter';
import type { NextAuthOptions } from 'next-auth';
import type { Adapter } from 'next-auth/adapters';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { sessionCookieOverride } from '@/server/auth/cookie-domain';
import { authenticateWithPassword } from '@/server/auth/credentials';
import { getPool } from '@/server/db/pool';

/**
 * NextAuth configuration (PRD FR-8): email + password and Sign in with Google, both backed by
 * task 2's Postgres schema through `@auth/pg-adapter`.
 *
 * Guests never come through here — see `@/lib/guest-identity`.
 */

/** Google only exists when the OAuth app is configured; local dev without it still boots. */
export function googleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Links a Google sign-in onto an existing account with the same email instead of rejecting it
 * with `OAuthAccountNotLinked`.
 *
 * NextAuth calls this "dangerous" because for a provider that does not verify email addresses,
 * anyone who can make the provider assert an address could take over the matching account.
 * It is enabled here because (a) the product requires one account per person whichever button
 * they press, and (b) it is scoped to Google, which verifies addresses — and the `signIn`
 * callback below additionally refuses any Google profile whose `email_verified` is not true, so
 * an unverified address can never reach the linking step.
 */
export const ALLOW_GOOGLE_EMAIL_LINKING = true;

function providers(): NextAuthOptions['providers'] {
  const list: NextAuthOptions['providers'] = [
    CredentialsProvider({
      id: 'credentials',
      name: 'Email và mật khẩu',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mật khẩu', type: 'password' },
      },
      async authorize(credentials) {
        const user = await authenticateWithPassword(
          getPool(),
          credentials?.email ?? '',
          credentials?.password ?? '',
        );
        if (!user) return null;

        return { id: user.id, email: user.email, name: user.displayName, image: user.image };
      },
    }),
  ];

  const google = googleCredentials();
  if (google) {
    list.push(
      GoogleProvider({
        ...google,
        allowDangerousEmailAccountLinking: ALLOW_GOOGLE_EMAIL_LINKING,
      }),
    );
  }

  return list;
}

/** Google's id_token claims we care about; `next-auth`'s Profile type leaves this one out. */
interface GoogleProfileEmail {
  email_verified?: boolean;
}

export const authOptions: NextAuthOptions = {
  // The adapter is @auth/core-shaped while next-auth v4 declares its own structurally identical
  // Adapter type; the cast bridges the two package boundaries, not a behavioural difference.
  adapter: PostgresAdapter(getPool()) as Adapter,
  providers: providers(),
  // Only set in the EC2 deployment, where the API answers on its own subdomain.
  cookies: sessionCookieOverride(),
  session: {
    // Forced by the Credentials provider: next-auth v4 refuses to issue database sessions for it,
    // because a credentials login never goes through the adapter. The adapter still owns users,
    // accounts and (for OAuth) linking — only the session itself lives in the JWT cookie.
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 30,
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === 'google') {
        // Guard for ALLOW_GOOGLE_EMAIL_LINKING above: without a verified address, linking by
        // email would be a way in to somebody else's account.
        return (profile as GoogleProfileEmail | undefined)?.email_verified === true;
      }
      return true;
    },
    async jwt({ token, user }) {
      // `user` is only present on the request that signs in; afterwards the id rides the token.
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub;
      }
      return session;
    },
  },
};
