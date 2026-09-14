'use client';

import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthStatus } from '@/components/auth-status';

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
        <p className="text-sm text-slate-400">
          Đăng nhập để lưu lịch sử phiên. Không bắt buộc — bạn vẫn có thể vào phòng với tư cách
          khách.
        </p>
      </header>

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
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
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
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
          />
        </div>

        {message ? (
          <p role="alert" data-testid="login-error" className="text-sm text-rose-400">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
        >
          {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500">
        <span className="h-px flex-1 bg-slate-800" />
        hoặc
        <span className="h-px flex-1 bg-slate-800" />
      </div>

      <button
        type="button"
        data-testid="google-signin"
        onClick={() => void signIn('google', { callbackUrl: '/' })}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800"
      >
        Đăng nhập với Google
      </button>

      <p className="text-sm text-slate-400">
        Chưa có tài khoản?{' '}
        <Link href="/register" className="font-medium text-indigo-400 hover:underline">
          Đăng ký
        </Link>{' '}
        ·{' '}
        <Link href="/join" className="font-medium text-indigo-400 hover:underline">
          Vào phòng với tư cách khách
        </Link>
      </p>
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
