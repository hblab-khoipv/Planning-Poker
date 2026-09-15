'use client';

import { historyPath } from '@planning-poker/shared';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';

/**
 * Who am I, and how do I stop being them. Minimal on purpose — the real header is a later task.
 *
 * It is also the only entry point to session history, which is why the link lives here rather
 * than beside the other home-page links: FR-9 exists for accounts only, so the way in has to
 * appear exactly when a session does and never for a guest (PRD §9.6).
 */
export function AuthStatus() {
  const { data: session, status } = useSession();

  if (status === 'loading') return null;

  if (!session?.user) {
    return (
      <p className="text-sm text-slate-400" data-testid="auth-status">
        Chưa đăng nhập.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="auth-status">
      <span className="text-slate-300">
        Đã đăng nhập:{' '}
        <strong className="text-slate-100">{session.user.name ?? session.user.email}</strong>
      </span>
      <Link
        href={historyPath()}
        data-testid="history-link"
        className="rounded border border-slate-700 px-3 py-1 font-medium text-slate-200 hover:bg-slate-800"
      >
        Lịch sử phiên
      </Link>
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: '/' })}
        className="rounded border border-slate-700 px-3 py-1 font-medium text-slate-200 hover:bg-slate-800"
      >
        Đăng xuất
      </button>
    </div>
  );
}
