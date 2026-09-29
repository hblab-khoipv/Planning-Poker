import { historyPath } from '@planning-poker/shared';

/**
 * What to offer a visitor about their identity, given what `useSession()` currently knows.
 *
 * The bug this exists to make impossible: the home page offered "Đăng nhập / Đăng ký"
 * unconditionally while `AuthStatus` right beside it greeted the signed-in person by name, so
 * the page contradicted itself. The rule is small but it has three branches and two of them are
 * easy to get wrong, so it lives here as a pure function — the same reason `lib/table-seats.ts`
 * does — and every screen that offers an identity action asks this module instead of deciding
 * again in JSX.
 *
 * The product rule underneath is unchanged (PRD §3.1.1): signing in is optional and guests still
 * create and join rooms. Only what an *already signed-in* person is shown changes.
 */

/** `useSession().status`, restated so this module does not depend on next-auth. */
export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

/**
 * The three states a screen has to render, named after what the visitor is rather than after the
 * hook's vocabulary. `loading` is a state of its own on purpose: treating it as "guest" is what
 * flashes a sign-in button at somebody who is already signed in.
 */
export type IdentityState = 'loading' | 'signed-in' | 'guest';

export interface IdentityCta {
  id: 'login' | 'guest' | 'history';
  href: string;
  label: string;
  /** Kept stable across states so the existing e2e specs still have something to count. */
  testId: string;
}

export function identityState(status: SessionStatus): IdentityState {
  if (status === 'loading') return 'loading';
  return status === 'authenticated' ? 'signed-in' : 'guest';
}

/**
 * May this state be shown a sign-in / sign-up / "continue as guest" offer at all?
 *
 * Only a confirmed guest may. A signed-in person has nothing to gain from it, and while the
 * session is still loading we do not yet know which they are — and guessing is the bug.
 */
export function offersSignIn(state: IdentityState): boolean {
  return state === 'guest';
}

const LOGIN_CTA: IdentityCta = {
  id: 'login',
  href: '/login',
  label: 'Đăng nhập / Đăng ký',
  testId: 'home-login-link',
};

const GUEST_CTA: IdentityCta = {
  id: 'guest',
  href: '/join',
  label: 'Vào phòng với tư cách khách',
  testId: 'home-guest-link',
};

/**
 * The home page's identity-section buttons.
 *
 * Signed in: none. Not "none because there is nothing useful left" — `AuthStatus` sits directly
 * above this row and already offers the two actions that are useful to an account, "Lịch sử
 * phiên" and "Đăng xuất", so repeating either here would put the same link on the screen twice.
 * Creating and joining a room are the two cards at the top of the page, for everybody.
 *
 * Loading: also none, paired with {@link identityNote}'s placeholder line so the section keeps
 * its height instead of collapsing and then jumping.
 */
export function homeIdentityCtas(state: IdentityState): IdentityCta[] {
  return offersSignIn(state) ? [LOGIN_CTA, GUEST_CTA] : [];
}

/** The sentence under the buttons — one per state, never absent, so nothing shifts. */
export function identityNote(state: IdentityState): string {
  switch (state) {
    case 'loading':
      return 'Đang kiểm tra phiên đăng nhập…';
    case 'signed-in':
      return 'Phiên của bạn sẽ được lưu vào lịch sử. Tạo và vào phòng vẫn như thường.';
    case 'guest':
      return 'Đăng nhập chỉ để lưu lịch sử phiên — tạo và vào phòng không bắt buộc phải có tài khoản.';
  }
}

/** Where "you are already signed in" screens send somebody next. */
export const HISTORY_CTA: IdentityCta = {
  id: 'history',
  href: historyPath(),
  label: 'Lịch sử phiên',
  testId: 'already-signed-in-history-link',
};
