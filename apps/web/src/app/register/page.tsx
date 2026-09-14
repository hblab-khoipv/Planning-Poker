'use client';

import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MIN_PASSWORD_LENGTH, validateRegistration } from '@/lib/auth-validation';

/**
 * Đăng ký (PRD §9.5). Validates with the same module the API route uses, then signs the new
 * account straight in so registration ends where login does.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);

    const validation = validateRegistration({ email, password, displayName });
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }

    setPending(true);
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validation.value),
    });

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const messages = (body as { errors?: unknown })?.errors;
      setErrors(Array.isArray(messages) ? messages.map(String) : ['Đăng ký thất bại.']);
      setPending(false);
      return;
    }

    const signedIn = await signIn('credentials', {
      email: validation.value.email,
      password: validation.value.password,
      redirect: false,
    });
    setPending(false);

    if (signedIn?.error) {
      router.push('/login');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Đăng ký</h1>
        <p className="text-sm text-slate-400">Tài khoản dùng để lưu lịch sử các phiên estimate.</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4" data-testid="register-form">
        <div className="space-y-1">
          <label htmlFor="displayName" className="block text-sm font-medium">
            Tên hiển thị
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
          />
        </div>

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
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
          />
          <p className="text-xs text-slate-500">Tối thiểu {MIN_PASSWORD_LENGTH} ký tự.</p>
        </div>

        {errors.length > 0 ? (
          <ul
            role="alert"
            data-testid="register-errors"
            className="space-y-1 text-sm text-rose-400"
          >
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
        >
          {pending ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
        </button>
      </form>

      <button
        type="button"
        data-testid="google-signin"
        onClick={() => void signIn('google', { callbackUrl: '/' })}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800"
      >
        Đăng ký với Google
      </button>

      <p className="text-sm text-slate-400">
        Đã có tài khoản?{' '}
        <Link href="/login" className="font-medium text-indigo-400 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </main>
  );
}
