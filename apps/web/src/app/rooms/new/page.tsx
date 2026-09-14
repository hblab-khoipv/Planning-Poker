'use client';

import {
  DECK_TYPES,
  DECKS,
  type DeckType,
  MAX_GUEST_NAME_LENGTH,
  roomPath,
} from '@planning-poker/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { createRoom, messageForError } from '@/lib/api-client';
import { browserIdentityStore, readGuestIdentity, saveGuestIdentity } from '@/lib/guest-identity';
import { saveRoomMembership } from '@/lib/room-membership';

const DECK_LABELS: Record<DeckType, string> = {
  fibonacci: 'Fibonacci',
  tshirt: 'T-shirt size',
};

/**
 * PRD §9.2 / FR-1: name the room and pick a deck. The creator is seated straight away, as host
 * when they are signed in, so they land inside their own room rather than next to it.
 */
export default function CreateRoomPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const signedIn = status === 'authenticated';

  const [name, setName] = useState('');
  const [deckType, setDeckType] = useState<DeckType>('fibonacci');
  const [displayName, setDisplayName] = useState('');
  // Once the creator edits the field, no prefill may overwrite what they typed.
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Prefill whichever name we already know: the account's, or the one this browser last used.
   * `status` is 'loading' on the first render even for a signed-in visitor, so waiting for it is
   * what stops a stale guest name from being offered to somebody who does have an account.
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

    if (name.trim().length === 0) {
      setError('Hãy đặt tên cho phòng.');
      return;
    }
    if (!signedIn && displayName.trim().length === 0) {
      setError('Hãy nhập tên hiển thị của bạn.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const { room, participant } = await createRoom({
        name: name.trim(),
        deckType,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });

      const store = browserIdentityStore();
      if (store) {
        saveRoomMembership(store, room.code, participant.id);
        if (!signedIn) saveGuestIdentity(store, displayName);
      }

      router.push(roomPath(room.code));
    } catch (caught) {
      setError(messageForError(caught));
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Tạo phòng mới</h1>
        <p className="text-sm text-slate-400">
          Sau khi tạo, bạn sẽ nhận được link mời để gửi cho team.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5" data-testid="create-room-form">
        <div className="space-y-1">
          <label htmlFor="room-name" className="block text-sm font-medium">
            Tên phòng
          </label>
          <input
            id="room-name"
            name="roomName"
            type="text"
            maxLength={80}
            required
            placeholder="VD: Sprint 42 refinement"
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-testid="room-name-input"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Bộ thẻ điểm</legend>
          {DECK_TYPES.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 has-[:checked]:border-indigo-400"
            >
              <input
                type="radio"
                name="deckType"
                value={type}
                checked={deckType === type}
                onChange={() => setDeckType(type)}
                data-testid={`deck-option-${type}`}
                className="mt-1"
              />
              <span className="space-y-1">
                <span className="block font-medium">{DECK_LABELS[type]}</span>
                <span className="block font-mono text-xs text-slate-400">
                  {DECKS[type].join('  ·  ')}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {signedIn ? null : (
          <div className="space-y-1">
            <label htmlFor="host-name" className="block text-sm font-medium">
              Tên hiển thị của bạn
            </label>
            <input
              id="host-name"
              name="displayName"
              type="text"
              maxLength={MAX_GUEST_NAME_LENGTH}
              required
              value={displayName}
              onChange={(event) => {
                setNameTouched(true);
                setDisplayName(event.target.value);
              }}
              data-testid="host-name-input"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-indigo-400"
            />
          </div>
        )}

        {error ? (
          <p role="alert" data-testid="create-room-error" className="text-sm text-rose-400">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          data-testid="create-room-submit"
          className="w-full rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white hover:bg-indigo-400 disabled:opacity-60"
        >
          {submitting ? 'Đang tạo phòng…' : 'Tạo phòng'}
        </button>
      </form>

      <Link href="/" className="text-sm font-medium text-indigo-400 hover:underline">
        ← Về trang chủ
      </Link>
    </main>
  );
}
