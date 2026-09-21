import { describe, expect, it } from 'vitest';
import {
  homeIdentityCtas,
  type IdentityState,
  identityNote,
  identityState,
  offersSignIn,
  type SessionStatus,
} from './identity-cta';

const STATES: IdentityState[] = ['loading', 'signed-in', 'guest'];

describe('identityState', () => {
  it('maps next-auth status onto the three states a screen renders', () => {
    const cases: Array<[SessionStatus, IdentityState]> = [
      ['loading', 'loading'],
      ['authenticated', 'signed-in'],
      ['unauthenticated', 'guest'],
    ];

    for (const [status, expected] of cases) {
      expect(identityState(status)).toBe(expected);
    }
  });

  it('does not treat "loading" as signed out', () => {
    // The whole bug in one assertion: an unresolved session must not be answered as if the
    // visitor were a guest, or the sign-in button flashes at somebody who is signed in.
    expect(identityState('loading')).not.toBe(identityState('unauthenticated'));
  });
});

describe('offersSignIn', () => {
  it('is true only for a confirmed guest', () => {
    expect(offersSignIn('guest')).toBe(true);
    expect(offersSignIn('signed-in')).toBe(false);
    expect(offersSignIn('loading')).toBe(false);
  });
});

describe('homeIdentityCtas', () => {
  it('offers a guest both ways in', () => {
    expect(homeIdentityCtas('guest').map((cta) => cta.id)).toEqual(['login', 'guest']);
  });

  it('offers a signed-in person neither sign-in nor guest identity', () => {
    expect(homeIdentityCtas('signed-in')).toEqual([]);
  });

  it('offers nothing while the session is still loading', () => {
    expect(homeIdentityCtas('loading')).toEqual([]);
  });

  it('keeps the test ids the e2e suite counts on the guest branch', () => {
    expect(homeIdentityCtas('guest').map((cta) => cta.testId)).toEqual([
      'home-login-link',
      'home-guest-link',
    ]);
  });

  it('never returns a sign-in or guest-identity link to a state that may not be offered one', () => {
    for (const state of STATES) {
      if (offersSignIn(state)) continue;
      expect(homeIdentityCtas(state)).toHaveLength(0);
    }
  });
});

describe('identityNote', () => {
  it('says something in every state, so the section never collapses', () => {
    for (const state of STATES) {
      expect(identityNote(state).length).toBeGreaterThan(0);
    }
  });

  it('never invites a signed-in person to sign in', () => {
    // "Đang kiểm tra phiên đăng nhập…" contains the words but is a status, not an offer, so the
    // assertion is about the invitation the guest note makes: an account you do not yet have.
    expect(identityNote('signed-in')).not.toMatch(/không bắt buộc/);
    expect(identityNote('signed-in')).not.toMatch(/tài khoản/i);
    expect(identityNote('loading')).not.toMatch(/tài khoản/i);
  });

  it('still tells a guest that an account is optional (PRD §3.1.1)', () => {
    expect(identityNote('guest')).toMatch(/không bắt buộc/);
  });
});
