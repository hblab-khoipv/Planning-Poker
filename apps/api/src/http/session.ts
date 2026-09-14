import type { Request } from 'express';
import { decode } from 'next-auth/jwt';
import { config } from '../config.js';

/**
 * Who is calling, according to NextAuth.
 *
 * Auth lives in `apps/web`, but the room endpoints live here, so the API has to be able to
 * verify a caller without trusting a user id sent in the body. NextAuth v4 issues an encrypted
 * JWT (JWE) derived from `NEXTAUTH_SECRET` and stores it in a cookie; both processes share that
 * secret, so this side can decrypt the same cookie and get a `sub` it did not have to be told.
 * The cookie reaches us because the web app and the API are the same site (cookies ignore the
 * port), which is also true of the single-host EC2 deployment target.
 *
 * No secret configured means no way to verify anybody: every caller is then treated as a guest,
 * which is a safe default — it can only ever deny privileges, never grant them.
 */

/** Cookie names NextAuth v4 uses, insecure first because that is the local/dev case. */
const SESSION_COOKIE_NAMES = ['next-auth.session-token', '__Secure-next-auth.session-token'];

export interface CallerIdentity {
  userId: string;
}

/** Minimal cookie-header parser; the API has no cookie middleware and needs exactly one value. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && !(name in cookies)) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function readSessionToken(header: string | undefined): string | null {
  const cookies = parseCookies(header);
  for (const name of SESSION_COOKIE_NAMES) {
    const value = cookies[name];
    if (value) return value;
  }
  return null;
}

/**
 * Returns the signed-in caller behind a raw `Cookie` header, or null for a guest (no cookie,
 * expired or tampered token, or no shared secret). Never throws: a bad cookie is a guest, not a
 * 500. Split out from `resolveCaller` because a Socket.io handshake is not an Express request
 * but carries the very same cookie (`apps/api/src/realtime/identity.ts`).
 */
export async function resolveCallerFromCookieHeader(
  header: string | undefined,
): Promise<CallerIdentity | null> {
  const secret = config.nextAuthSecret;
  if (!secret) return null;

  const token = readSessionToken(header);
  if (!token) return null;

  try {
    const payload = await decode({ token, secret });
    return payload?.sub ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}

/** The same question, asked of an Express request. */
export async function resolveCaller(req: Request): Promise<CallerIdentity | null> {
  return resolveCallerFromCookieHeader(req.headers.cookie);
}
