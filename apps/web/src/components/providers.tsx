'use client';

import { SessionProvider } from 'next-auth/react';

/** `useSession` needs this context; it is the only reason the root layout has a client boundary. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
