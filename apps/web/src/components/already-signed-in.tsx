'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { HISTORY_CTA } from '@/lib/identity-cta';

/**
 * What `/login` and `/register` show instead of their form when a session already exists.
 *
 * Reaching either screen while signed in is normally a bookmark or a back button rather than a
 * mistake, so this neither redirects nor 404s — it answers the question the visitor arrived with
 * ("am I signed in?") and offers the two ways onward, including signing out if they came to swap
 * accounts.
 */
export function AlreadySignedIn({ heading }: { heading: string }) {
  const { data: session } = useSession();
  const who = session?.user?.name ?? session?.user?.email ?? '';

  return (
    <section
      data-testid="already-signed-in"
      className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
    >
      <h2 className="text-xl font-semibold">{heading}</h2>
      <p className="text-sm text-slate-400">
        Bạn đang đăng nhập{who ? ' với ' : ''}
        {who ? <strong className="text-slate-100">{who}</strong> : null}.
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/"
          data-testid="already-signed-in-home-link"
          className="rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white hover:bg-indigo-400"
        >
          Về trang chủ
        </Link>
        <Link
          href={HISTORY_CTA.href}
          data-testid={HISTORY_CTA.testId}
          className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800"
        >
          {HISTORY_CTA.label}
        </Link>
        <button
          type="button"
          onClick={() => void signOut({ callbackUrl: '/' })}
          className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800"
        >
          Đăng xuất
        </button>
      </div>
    </section>
  );
}
