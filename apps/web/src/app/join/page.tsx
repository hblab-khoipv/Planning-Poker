'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  browserIdentityStore,
  isValidGuestName,
  readGuestIdentity,
  saveGuestIdentity,
  type GuestIdentity,
} from '@/lib/guest-identity';

/**
 * Nhập tên hiển thị để vào phòng với tư cách khách (PRD §9.3, FR-2).
 *
 * Nothing here touches NextAuth or the `users` table: the identity is a random participant id
 * kept in this browser plus the name typed below. Task 4 turns that pair into a
 * `room_participants` row with `user_id` NULL.
 */
export default function JoinPage() {
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState<GuestIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const store = browserIdentityStore();
    if (!store) return;

    const existing = readGuestIdentity(store);
    if (existing) {
      setIdentity(existing);
      setName(existing.displayName);
    }
  }, []);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValidGuestName(name)) {
      setError('Hãy nhập tên hiển thị.');
      return;
    }

    const store = browserIdentityStore();
    if (!store) return;

    setError(null);
    setIdentity(saveGuestIdentity(store, name));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Vào phòng với tư cách khách</h1>
        <p className="text-sm text-slate-400">
          Không cần tài khoản — chỉ cần một cái tên để mọi người trong phòng nhận ra bạn.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4" data-testid="guest-form">
        <div className="space-y-1">
          <label htmlFor="guest-name" className="block text-sm font-medium">
            Tên hiển thị
          </label>
          <input
            id="guest-name"
            name="guestName"
            type="text"
            maxLength={40}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
          />
        </div>

        {error ? (
          <p role="alert" data-testid="guest-error" className="text-sm text-rose-400">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white hover:bg-indigo-400"
        >
          Lưu tên và tiếp tục
        </button>
      </form>

      {identity ? (
        <div
          data-testid="guest-identity"
          className="space-y-1 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm"
        >
          <p className="text-slate-300">
            Bạn sẽ vào phòng với tên{' '}
            <strong data-testid="guest-display-name" className="text-slate-100">
              {identity.displayName}
            </strong>
          </p>
          <p className="break-all text-xs text-slate-500">
            participant_id: <span data-testid="guest-participant-id">{identity.participantId}</span>
          </p>
          <p className="text-xs text-slate-500">
            Mã này được lưu trong trình duyệt để bạn vẫn là chính mình sau khi tải lại trang. Chức
            năng chọn phòng sẽ có ở bước sau.
          </p>
        </div>
      ) : null}

      <p className="text-sm text-slate-400">
        Muốn lưu lịch sử phiên?{' '}
        <Link href="/login" className="font-medium text-indigo-400 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </main>
  );
}
