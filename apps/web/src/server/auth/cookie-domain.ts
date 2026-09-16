import type { NextAuthOptions } from 'next-auth';

/**
 * Makes NextAuth's session cookie visible to the API's hostname.
 *
 * In local dev both processes answer on `localhost`, so the cookie reaches `apps/api` for free
 * (cookies ignore the port). Production cannot do that: the web app owns `/rooms/:code` as a
 * *page* and the API owns `/rooms/:code` as *JSON*, so one hostname cannot route both and the
 * API gets its own — `api.<domain>` (see deploy/nginx/planning-poker.conf). A host-only cookie
 * set on `<domain>` would never be sent there, and every signed-in member would look like a
 * guest to the room endpoints and the socket handshake.
 *
 * Setting AUTH_COOKIE_DOMAIN=.<domain> widens exactly one cookie — the session token — to the
 * registrable domain, which keeps SameSite=Lax satisfied (the two hosts are the same site).
 * The CSRF cookie is deliberately left alone: it keeps NextAuth's `__Host-` prefix, which forbids
 * a Domain attribute, and is only ever needed on the web origin anyway.
 *
 * Unset (the default, and every local/CI run) means NextAuth's own defaults, unchanged.
 */
export function sessionCookieOverride(
  domain: string | undefined = process.env.AUTH_COOKIE_DOMAIN,
): NextAuthOptions['cookies'] {
  const trimmed = domain?.trim();
  if (!trimmed) return undefined;

  return {
    sessionToken: {
      // The `__Secure-` prefix is what NextAuth itself uses for an https deployment, and
      // `apps/api/src/http/session.ts` already reads both spellings.
      name: '__Secure-next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
        domain: trimmed,
      },
    },
  };
}
