'use client';

import { joinPath, parseRoomCode } from '@planning-poker/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** PRD §9.1: the "I already have a code" half of the home page. */
export function JoinByCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized = parseRoomCode(code);
    if (!normalized) {
      setError('Mã phòng gồm 8 ký tự, ví dụ 7K2M9QXB.');
      return;
    }

    setError(null);
    router.push(joinPath(normalized));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="join-by-code-form">
      <div className="space-y-1">
        <label htmlFor="room-code" className="block text-sm font-medium">
          Mã phòng
        </label>
        <div className="flex gap-2">
          <input
            id="room-code"
            name="roomCode"
            type="text"
            autoComplete="off"
            placeholder="VD: 7K2M9QXB"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            data-testid="join-code-input"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono uppercase tracking-widest text-slate-100 outline-none focus:border-indigo-400"
          />
          <button
            type="submit"
            data-testid="join-code-submit"
            className="shrink-0 rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800"
          >
            Vào phòng
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" data-testid="join-code-error" className="text-sm text-rose-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
