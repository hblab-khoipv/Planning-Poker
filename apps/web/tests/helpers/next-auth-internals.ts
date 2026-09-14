import { createRequire } from 'node:module';
import type { Adapter, AdapterSession, AdapterUser } from 'next-auth/adapters';
import type { NextAuthOptions } from 'next-auth';

/**
 * Two pieces of next-auth v4 that the integration tests need and that the package does not
 * expose through its `exports` map, so they are resolved from its own entry point:
 *
 * - `parseProviders`, which turns the objects in `authOptions.providers` into what NextAuth
 *   actually runs. This is not an optional nicety: `GoogleProvider({...})` and
 *   `CredentialsProvider({...})` stash the caller's settings under `.options` and NextAuth merges
 *   them in at request time, so the un-parsed object has a stub `authorize` and no
 *   `allowDangerousEmailAccountLinking`. Testing the raw object would test nothing.
 * - `callbackHandler`, the function the /api/auth/callback/:provider route calls once a provider
 *   has verified the user — the real "same person or new person" decision.
 *
 * Both throw a pointed error if a next-auth upgrade moves them, rather than letting the suite
 * quietly fall back to something weaker.
 */

const nodeRequire = createRequire(import.meta.url);

function loadInternal<T>(relativePath: string, pick: (module: unknown) => T | undefined): T {
  const path = nodeRequire.resolve('next-auth').replace(/index\.js$/, relativePath);
  const loaded: unknown = nodeRequire(path);

  const value = pick(loaded);
  if (value === undefined) {
    throw new Error(`next-auth internal not found at ${path} — did next-auth change?`);
  }
  return value;
}

function defaultExport<T>(module: unknown): T | undefined {
  const candidate = (module as { default?: unknown }).default;
  return typeof candidate === 'function' ? (candidate as T) : undefined;
}

/** The provider config NextAuth itself would use, user options merged in. */
export type InternalProvider = Record<string, unknown> & { id: string; type: string };

type ParseProviders = (params: { providers: NextAuthOptions['providers']; url: string }) => {
  providers: InternalProvider[];
};

export function internalProviders(options: NextAuthOptions): InternalProvider[] {
  const parseProviders = loadInternal<ParseProviders>('core/lib/providers.js', defaultExport);

  return parseProviders({ providers: options.providers, url: 'http://localhost:3000/api/auth' })
    .providers;
}

export function internalProvider(options: NextAuthOptions, id: string): InternalProvider {
  const provider = internalProviders(options).find((candidate) => candidate.id === id);
  if (!provider) throw new Error(`provider ${id} is not configured`);
  return provider;
}

export interface CallbackHandlerParams {
  profile: { email?: string | null; name?: string | null; image?: string | null };
  account: Record<string, unknown>;
  options: {
    adapter: Adapter;
    jwt: Record<string, unknown>;
    events: Record<string, unknown>;
    session: {
      strategy: 'jwt' | 'database';
      generateSessionToken?: () => string;
      maxAge?: number;
    };
    provider: Record<string, unknown>;
  };
}

export type CallbackHandler = (params: CallbackHandlerParams) => Promise<{
  user: AdapterUser;
  session?: AdapterSession | Record<string, unknown> | null;
  isNewUser?: boolean;
}>;

export function loadCallbackHandler(): CallbackHandler {
  return loadInternal<CallbackHandler>('core/lib/callback-handler.js', defaultExport);
}
