import type { Request } from 'express';
import { encode } from 'next-auth/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { parseCookies, readSessionToken, resolveCaller } from './session.js';

/**
 * The API identifies a caller by decrypting the very cookie NextAuth issued in `apps/web`, so
 * these tests mint tokens with next-auth's own `encode` rather than a hand-rolled fixture.
 */

const SECRET = 'test-next-auth-secret';

function requestWithCookie(cookie: string | undefined): Request {
  return { headers: cookie === undefined ? {} : { cookie } } as Request;
}

describe('parseCookies', () => {
  it('returns nothing for a missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it('splits a header into name/value pairs and url-decodes the values', () => {
    expect(parseCookies('a=1; b=hello%20world')).toEqual({ a: '1', b: 'hello world' });
  });

  it('keeps the first value when a name repeats', () => {
    expect(parseCookies('a=first; a=second')).toEqual({ a: 'first' });
  });

  it('tolerates a value containing "=" — JWTs and base64 both do', () => {
    expect(parseCookies('token=aa.bb=cc')).toEqual({ token: 'aa.bb=cc' });
  });

  it('ignores malformed segments rather than inventing empty names', () => {
    expect(parseCookies('; =orphan; a=1')).toEqual({ a: '1' });
  });
});

describe('readSessionToken', () => {
  it('finds the plain cookie NextAuth uses over http', () => {
    expect(readSessionToken('other=1; next-auth.session-token=abc')).toBe('abc');
  });

  it('finds the __Secure- prefixed cookie NextAuth uses over https', () => {
    expect(readSessionToken('__Secure-next-auth.session-token=abc')).toBe('abc');
  });

  it('returns null when no session cookie is present', () => {
    expect(readSessionToken('theme=dark')).toBeNull();
  });
});

describe('resolveCaller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function withSecret(secret: string): void {
    vi.spyOn(config, 'nextAuthSecret', 'get').mockReturnValue(secret);
  }

  it('returns the user id from a token NextAuth would have issued', async () => {
    withSecret(SECRET);
    const token = await encode({ token: { sub: 'user-42' }, secret: SECRET });

    await expect(
      resolveCaller(requestWithCookie(`next-auth.session-token=${token}`)),
    ).resolves.toEqual({ userId: 'user-42' });
  });

  it('treats a request with no cookie as a guest', async () => {
    withSecret(SECRET);

    await expect(resolveCaller(requestWithCookie(undefined))).resolves.toBeNull();
  });

  it('treats a token signed with another secret as a guest, not an error', async () => {
    const token = await encode({ token: { sub: 'user-42' }, secret: 'someone-elses-secret' });
    withSecret(SECRET);

    await expect(
      resolveCaller(requestWithCookie(`next-auth.session-token=${token}`)),
    ).resolves.toBeNull();
  });

  it('treats a garbage cookie value as a guest', async () => {
    withSecret(SECRET);

    await expect(
      resolveCaller(requestWithCookie('next-auth.session-token=not-a-jwt')),
    ).resolves.toBeNull();
  });

  it('cannot authenticate anybody when no secret is shared with the web app', async () => {
    const token = await encode({ token: { sub: 'user-42' }, secret: SECRET });
    withSecret('');

    await expect(
      resolveCaller(requestWithCookie(`next-auth.session-token=${token}`)),
    ).resolves.toBeNull();
  });
});
