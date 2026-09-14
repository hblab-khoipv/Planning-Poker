'use client';

import {
  DECKS,
  joinPath,
  type ParticipantDto,
  parseRoomCode,
  type RoomDto,
} from '@planning-poker/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { InviteLink } from '@/components/invite-link';
import { ParticipantList } from '@/components/participant-list';
import { fetchParticipants, fetchRoom, messageForError } from '@/lib/api-client';
import { browserIdentityStore } from '@/lib/guest-identity';
import { readRoomMembership } from '@/lib/room-membership';

/**
 * The room screen (PRD §9.4), with only the parts task 4 owns: the room's identity, the invite
 * link and the participant list.
 *
 * The list is polled. Task 5 replaces `POLL_INTERVAL_MS` with the Socket.io stream (FR-3's
 * "real-time"); the cards, reveal and results areas arrive with tasks 5-6.
 */

const POLL_INTERVAL_MS = 3000;

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = parseRoomCode(typeof params?.code === 'string' ? params.code : '');

  const [room, setRoom] = useState<RoomDto | null>(null);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mySeatId, setMySeatId] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const store = browserIdentityStore();
    setMySeatId(store ? readRoomMembership(store, code) : null);
  }, [code]);

  const refresh = useCallback(async () => {
    if (!code) return;
    const { participants: current } = await fetchParticipants(code);
    setParticipants(current);
  }, [code]);

  useEffect(() => {
    if (!code) {
      setError('Mã phòng không hợp lệ.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    fetchRoom(code)
      .then(async ({ room: found }) => {
        if (cancelled) return;
        setRoom(found);
        await refresh();
        if (!cancelled)
          timer = setInterval(() => void refresh().catch(() => undefined), POLL_INTERVAL_MS);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(messageForError(caught));
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [code, refresh]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Không mở được phòng</h1>
        <p role="alert" data-testid="room-error" className="text-sm text-rose-400">
          {error}
        </p>
        <Link href="/join" className="text-sm font-medium text-indigo-400 hover:underline">
          ← Nhập lại mã phòng
        </Link>
      </main>
    );
  }

  if (!room || !code) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-16">
        <p className="text-sm text-slate-400" data-testid="room-loading">
          Đang tải phòng…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-widest text-indigo-400">Phòng estimate</p>
        <h1 data-testid="room-name" className="text-3xl font-bold tracking-tight">
          {room.name}
        </h1>
        <p className="text-sm text-slate-400">
          Mã phòng:{' '}
          <span data-testid="room-code" className="font-mono">
            {room.code}
          </span>{' '}
          · Bộ thẻ: <span data-testid="room-deck-type">{room.deckType}</span>
        </p>
        <p className="font-mono text-xs text-slate-500" data-testid="room-deck-preview">
          {DECKS[room.deckType].join('  ·  ')}
        </p>
      </header>

      <InviteLink code={room.code} />

      {mySeatId ? null : (
        <p
          data-testid="room-not-joined"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          Bạn đang xem phòng này mà chưa tham gia.{' '}
          <Link href={joinPath(room.code)} className="font-semibold underline">
            Vào phòng
          </Link>
        </p>
      )}

      <ParticipantList participants={participants} currentParticipantId={mySeatId} />

      <p className="text-sm text-slate-500" data-testid="room-next-steps">
        Danh sách hiện đang được cập nhật bằng polling mỗi {POLL_INTERVAL_MS / 1000} giây; bản
        real-time qua Socket.io cùng với bộ thẻ, nút “Lộ bài” và kết quả sẽ có ở các bước tiếp theo.
      </p>
    </main>
  );
}
