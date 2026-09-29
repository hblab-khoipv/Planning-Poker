'use client';

import { type RoomHistoryEntryDto, roomHistoryPath } from '@planning-poker/shared';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { ApiError, fetchMyRoomHistory, messageForError } from '@/lib/api-client';
import { formatTimestamp, summarizeRounds } from '@/lib/history-format';

/**
 * Lịch sử phiên (PRD §9.6): the rooms this account has been in, newest first.
 *
 * Signed-in only, and the screen says so rather than pretending to be empty — a guest has no
 * account for a session to have been recorded against, so "chưa có phòng nào" would be the wrong
 * answer to give them (FR-9, PRD §3.1.10). The session is checked here purely to render the right
 * thing; the API answers 401 to the request regardless of what this component believes.
 */
export default function HistoryPage() {
  const { status } = useSession();
  const [rooms, setRooms] = useState<RoomHistoryEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;
    setError(null);
    fetchMyRoomHistory()
      .then(({ rooms: found }) => {
        if (!cancelled) setRooms(found);
      })
      .catch((caught: unknown) => {
        // A 401 here means the API disagrees with next-auth about the session — an expired
        // cookie, usually. Showing the sign-in prompt is more useful than an error.
        if (cancelled) return;
        if (caught instanceof ApiError && caught.isUnauthorized) setRooms(null);
        else setError(messageForError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-widest text-indigo-400">Lịch sử</p>
        <h1 className="text-3xl font-bold tracking-tight">Phiên đã tham gia</h1>
        <p className="text-sm text-slate-400">
          Các phòng bạn đã tạo hoặc tham gia, kèm kết quả những round đã lật bài.
        </p>
      </header>

      {status === 'loading' ? (
        <p data-testid="history-loading" className="text-sm text-slate-400">
          Đang tải…
        </p>
      ) : null}

      {status === 'unauthenticated' ? (
        <section
          data-testid="history-signed-out"
          className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
        >
          <h2 className="text-xl font-semibold">Cần đăng nhập</h2>
          <p className="text-sm text-slate-400">
            Lịch sử phiên chỉ có cho tài khoản đã đăng nhập — phiên của khách không được lưu lại.
          </p>
          <Link
            href="/login"
            data-testid="history-login-link"
            className="inline-block rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white hover:bg-indigo-400"
          >
            Đăng nhập
          </Link>
        </section>
      ) : null}

      {error ? (
        <p role="alert" data-testid="history-error" className="text-sm text-rose-400">
          {error}
        </p>
      ) : null}

      {status === 'authenticated' && rooms !== null ? (
        rooms.length === 0 ? (
          <p
            data-testid="history-empty"
            className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-400"
          >
            Bạn chưa tham gia phòng nào. Tạo một phòng và mời team vào để bắt đầu.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="history-list">
            {rooms.map((entry) => (
              <li key={entry.room.id}>
                <Link
                  href={roomHistoryPath(entry.room.code)}
                  data-testid="history-room"
                  data-room-code={entry.room.code}
                  className="block space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-5 hover:border-indigo-500"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span data-testid="history-room-name" className="text-lg font-semibold">
                      {entry.room.name}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{entry.room.code}</span>
                  </div>
                  <p className="text-sm text-slate-400">
                    <span data-testid="history-room-deck">{entry.room.deckType}</span> ·{' '}
                    <span data-testid="history-room-participants">
                      {entry.participantCount} người
                    </span>{' '}
                    · <span data-testid="history-room-rounds">{summarizeRounds(entry)}</span>
                  </p>
                  <p className="text-xs text-slate-500" data-testid="history-room-revealed-at">
                    {entry.lastRevealedAt
                      ? `Lật bài gần nhất: ${formatTimestamp(entry.lastRevealedAt)}`
                      : 'Chưa có round nào được lật bài'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <p className="text-sm">
        <Link href="/" className="font-medium text-indigo-400 hover:underline">
          ← Về trang chủ
        </Link>
      </p>
    </main>
  );
}
