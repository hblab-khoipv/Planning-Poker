import { describe, expect, it } from 'vitest';
import { sessionCookieOverride } from '@/server/auth/cookie-domain';

describe('sessionCookieOverride', () => {
  it('leaves NextAuth defaults alone when no domain is configured', () => {
    expect(sessionCookieOverride(undefined)).toBeUndefined();
    expect(sessionCookieOverride('   ')).toBeUndefined();
  });

  it('widens only the session token, with the __Secure- name apps/api already reads', () => {
    const cookies = sessionCookieOverride('.poker.example.com');

    expect(Object.keys(cookies ?? {})).toEqual(['sessionToken']);
    expect(cookies?.sessionToken).toEqual({
      name: '__Secure-next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
        domain: '.poker.example.com',
      },
    });
  });
});
