'use client';

import Link from 'next/link';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AlreadySignedIn } from '@/components/already-signed-in';
import { AuthStatus } from '@/components/auth-status';
import { identityState } from '@/lib/identity-cta';

/**
 * Đăng nhập (PRD §9.5). Functional, not polished — the finished screens belong to a later task.
 */

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'Email hoặc mật khẩu không đúng.',
  OAuthAccountNotLinked: 'Email này đã được dùng với cách đăng nhập khác.',
  AccessDenied: 'Tài khoản Google chưa xác minh email nên không được phép đăng nhập.',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const state = identityState(status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const urlError = searchParams.get('error');
  const message = error ?? (urlError ? (ERROR_MESSAGES[urlError] ?? urlError) : null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const result = await signIn('credentials', { email, password, redirect: false });

    setPending(false);
    if (result?.error) {
      setError(ERROR_MESSAGES[result.error] ?? 'Đăng nhập thất bại.');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Đăng nhập</h1>
        {state === 'guest' ? (
          <p className="text-sm text-ink-muted">
            Đăng nhập để lưu lịch sử phiên. Không bắt buộc — bạn vẫn có thể vào phòng với tư cách
            khách.
          </p>
        ) : null}
      </header>

      {state === 'signed-in' ? (
        <AlreadySignedIn heading="Bạn đã đăng nhập rồi" />
      ) : state === 'loading' ? (
        /* Deliberate: a one-line placeholder rather than the form, so the sign-in form is never
           shown for a frame to somebody who turns out to be signed in. */
        <p data-testid="login-loading" className="text-sm text-ink-muted">
          Đang kiểm tra phiên đăng nhập…
        </p>
      ) : (
        <>
          <AuthStatus />

          <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
            <div className="space-y-1">
              <label htmlFor="email" className="block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-ink outline-none focus:border-brand"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="password" className="block text-sm font-medium">
                Mật khẩu
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-ink outline-none focus:border-brand"
              />
            </div>

            {message ? (
              <p role="alert" data-testid="login-error" className="text-sm text-danger-ink">
                {message}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-brand px-4 py-2 font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-ink-subtle">
            <span className="h-px flex-1 bg-surface-2" />
            hoặc
            <span className="h-px flex-1 bg-surface-2" />
          </div>

          <button
            type="button"
            data-testid="google-signin"
            onClick={() => void signIn('google', { callbackUrl: '/' })}
            className="w-full rounded-lg border border-line-strong bg-surface px-4 py-2 font-semibold text-ink hover:bg-surface-2"
          >
            Đăng nhập với Google
          </button>

          <p className="text-sm text-ink-muted">
            Chưa có tài khoản?{' '}
            <Link href="/register" className="font-medium text-brand-ink hover:underline">
              Đăng ký
            </Link>{' '}
            ·{' '}
            <Link href="/join" className="font-medium text-brand-ink hover:underline">
              Vào phòng với tư cách khách
            </Link>
          </p>
        </>
      )}
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
