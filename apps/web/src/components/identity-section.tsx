'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AuthStatus } from '@/components/auth-status';
import { homeIdentityCtas, identityNote, identityState } from '@/lib/identity-cta';

/**
 * The home page's "Tài khoản" section (PRD §9.1).
 *
 * This is the only part of the landing page that depends on who is looking, which is why it is a
 * client island rather than the whole page being `'use client'`. What it renders is decided by
 * `@/lib/identity-cta` — see there for why a signed-in person gets no buttons of their own.
 */
export function IdentitySection() {
  const { status } = useSession();
  const state = identityState(status);
  const ctas = homeIdentityCtas(state);

  return (
    <section aria-labelledby="identity-heading" className="space-y-3">
      <h2 id="identity-heading" className="text-xl font-semibold">
        Tài khoản
      </h2>
      <AuthStatus />
      {ctas.length > 0 ? (
        <div className="flex flex-wrap gap-3 text-sm">
          {ctas.map((cta) => (
            <Link
              key={cta.id}
              href={cta.href}
              data-testid={cta.testId}
              className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800"
            >
              {cta.label}
            </Link>
          ))}
        </div>
      ) : null}
      <p className="text-sm text-slate-400" data-testid="identity-note">
        {identityNote(state)}
      </p>
    </section>
  );
}
