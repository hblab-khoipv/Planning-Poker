'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { identityState, offersSignIn } from '@/lib/identity-cta';

/**
 * "Muốn lưu lịch sử phiên? Đăng nhập" — the aside the guest screens carry.
 *
 * It renders nothing at all unless the visitor is a confirmed guest, which includes rendering
 * nothing while the session is still loading: this is a one-line aside, so its absence costs no
 * layout, and showing it for a frame to somebody who is signed in is exactly the bug.
 */
export function SignInPrompt() {
  const { status } = useSession();

  if (!offersSignIn(identityState(status))) return null;

  return (
    <p className="text-sm text-ink-muted" data-testid="sign-in-prompt">
      Muốn lưu lịch sử phiên?{' '}
      <Link href="/login" className="font-medium text-brand-ink hover:underline">
        Đăng nhập
      </Link>
    </p>
  );
}
