'use client';

import {
  MAX_GUEST_NAME_LENGTH,
  parseRoomCode,
  type RoomDto,
  roomPath,
} from '@planning-poker/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { fetchRoom, joinRoom, messageForError } from '@/lib/api-client';
import { browserIdentityStore, readGuestIdentity, saveGuestIdentity } from '@/lib/guest-identity';
import { readRoomMembership, saveRoomMembership } from '@/lib/room-membership';

/**
 * PRD §9.3 / FR-2: the room is looked up first, so a mistyped code is an error on this screen
 * rather than after somebody has typed their name. A guest is seated with `user_id` NULL and
 * their browser remembers the seat (`@/lib/room-membership`); a signed-in visitor is matched on
 * their user id, so rejoining reuses the seat they already have.
 */
export default function JoinRoomPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const rawCode = typeof params?.code === 'string' ? params.code : '';
  const code = parseRoomCode(rawCode);

  const { data: session, status } = useSession();
  const signedIn = status === 'authenticated';

  const [room, setRoom] = useState<RoomDto | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  // Once the visitor edits the field, no prefill may overwrite what they typed.
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!code) {
      setLookupError('Mã phòng không hợp lệ. Mã phòng gồm 8 ký tự, ví dụ 7K2M9QXB.');
      return;
    }

    let cancelled = false;
    fetchRoom(code)
      .then(({ room: found }) => {
        if (!cancelled) setRoom(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLookupError(messageForError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  /**
   * Prefill the right name. `status` is 'loading' on the first render even for a signed-in
   * visitor, so waiting for it is what stops a stale guest name from being offered to somebody
   * who does have an account.
   */
  useEffect(() => {
    if (status === 'loading' || nameTouched) return;

    if (signedIn) {
      setDisplayName(session?.user?.name ?? '');
      return;
    }
    const store = browserIdentityStore();
    const identity = store && readGuestIdentity(store);
    setDisplayName(identity?.displayName ?? '');
  }, [status, signedIn, session?.user?.name, nameTouched]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code) return;

    if (!signedIn && displayName.trim().length === 0) {
      setError('Hãy nhập tên hiển thị.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const store = browserIdentityStore();
      const existingSeat = store ? readRoomMembership(store, code) : null;

      const { participant } = await joinRoom(code, {
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...(existingSeat ? { participantId: existingSeat } : {}),
      });

      if (store) {
        saveRoomMembership(store, code, participant.id);
        if (!signedIn) saveGuestIdentity(store, displayName);
      }

      router.push(roomPath(code));
    } catch (caught) {
      setError(messageForError(caught));
      setSubmitting(false);
    }
  }

  if (lookupError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Không vào được phòng</h1>
        <p role="alert" data-testid="join-room-error" className="text-sm text-rose-400">
          {lookupError}
        </p>
        <Link href="/join" className="text-sm font-medium text-indigo-400 hover:underline">
          ← Nhập lại mã phòng
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Vào phòng</h1>
        {room ? (
          <p className="text-sm text-slate-400">
            Phòng{' '}
            <strong data-testid="join-room-name" className="text-slate-100">
              {room.name}
            </strong>{' '}
            · mã <span className="font-mono">{room.code}</span>
          </p>
        ) : (
          <p className="text-sm text-slate-400" data-testid="join-room-loading">
            Đang kiểm tra mã phòng…
          </p>
        )}
      </header>

      <form onSubmit={onSubmit} className="space-y-4" data-testid="join-room-form">
        <div className="space-y-1">
          <label htmlFor="guest-name" className="block text-sm font-medium">
            Tên hiển thị
          </label>
          <input
            id="guest-name"
            name="displayName"
            type="text"
            maxLength={MAX_GUEST_NAME_LENGTH}
            required={!signedIn}
            value={displayName}
            onChange={(event) => {
              setNameTouched(true);
              setDisplayName(event.target.value);
            }}
            data-testid="join-name-input"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
          />
          {signedIn ? (
            <p className="text-xs text-slate-500">
              Bạn đang đăng nhập. Có thể đổi tên hiển thị riêng cho phòng này.
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" data-testid="join-room-error" className="text-sm text-rose-400">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !room}
          data-testid="join-room-submit"
          className="w-full rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
        >
          {submitting ? 'Đang vào phòng…' : 'Vào phòng'}
        </button>
      </form>

      {signedIn ? null : (
        <p className="text-sm text-slate-400">
          Muốn lưu lịch sử phiên?{' '}
          <Link href="/login" className="font-medium text-indigo-400 hover:underline">
            Đăng nhập
          </Link>
        </p>
      )}
    </main>
  );
}
