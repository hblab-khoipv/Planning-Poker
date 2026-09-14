'use client';

import {
  DECKS,
  joinPath,
  type ParticipantDto,
  type ParticipantJoinedPayload,
  type ParticipantLeftPayload,
  parseRoomCode,
  type RoomDto,
  type RoomStatePayload,
} from '@planning-poker/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { InviteLink } from '@/components/invite-link';
import { ParticipantList } from '@/components/participant-list';
import { fetchParticipants, fetchRoom, messageForError } from '@/lib/api-client';
import { browserIdentityStore } from '@/lib/guest-identity';
import { readRoomMembership } from '@/lib/room-membership';
import {
  applyParticipantJoined,
  applyParticipantLeft,
  connectToRoom,
  SOCKET_EVENTS,
} from '@/lib/room-socket';

/**
 * The room screen (PRD §9.4): the room's identity, the invite link, and a participant list that
 * is now pushed rather than polled (FR-3).
 *
 * Two ways in, on purpose. Somebody who has joined holds a seat, so they open a socket and the
 * list stays live — the snapshot on connect seeds it, `participant:joined`/`participant:left`
 * keep it current. Somebody who only followed the invite link has no seat yet; the API refuses
 * them a socket (a connection may never invent a participant), so they get a single REST read
 * and a prompt to join. The cards, reveal and results areas arrive with task 6.
 */

type ConnectionState = 'connecting' | 'live' | 'offline';

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = parseRoomCode(typeof params?.code === 'string' ? params.code : '');

  const [room, setRoom] = useState<RoomDto | null>(null);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mySeatId, setMySeatId] = useState<string | null>(null);
  const [seatChecked, setSeatChecked] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!code) return;
    const store = browserIdentityStore();
    setMySeatId(store ? readRoomMembership(store, code) : null);
    setSeatChecked(true);
  }, [code]);

  useEffect(() => {
    if (!code) {
      setError('Mã phòng không hợp lệ.');
      return;
    }

    let cancelled = false;
    fetchRoom(code)
      .then(({ room: found }) => {
        if (!cancelled) setRoom(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(messageForError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  // The live list. Re-runs when the seat appears, so joining in another tab upgrades this one
  // from the read-only view to the socket without a reload.
  useEffect(() => {
    if (!code || !seatChecked) return;

    let cancelled = false;

    if (!mySeatId) {
      setConnection('offline');
      void fetchParticipants(code)
        .then(({ participants: current }) => {
          if (!cancelled) setParticipants(current);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

    setConnection('connecting');
    const socket = connectToRoom({ roomCode: code, participantId: mySeatId });

    socket.on('connect', () => setConnection('live'));
    socket.on('disconnect', () => setConnection('connecting'));
    socket.on('connect_error', () => setConnection('offline'));

    socket.on(SOCKET_EVENTS.ROOM_STATE, (payload: RoomStatePayload) => {
      setParticipants(payload.participants);
    });
    socket.on(SOCKET_EVENTS.PARTICIPANT_JOINED, (payload: ParticipantJoinedPayload) => {
      setParticipants((current) => applyParticipantJoined(current, payload.participant));
    });
    socket.on(SOCKET_EVENTS.PARTICIPANT_LEFT, (payload: ParticipantLeftPayload) => {
      setParticipants((current) => applyParticipantLeft(current, payload.participantId));
    });

    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [code, mySeatId, seatChecked]);

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

      <ParticipantList
        participants={participants}
        currentParticipantId={mySeatId}
        connection={mySeatId ? connection : 'none'}
      />

      <p className="text-sm text-slate-500" data-testid="room-next-steps">
        Danh sách thành viên đã được đồng bộ real-time qua Socket.io. Bộ thẻ, nút “Lộ bài” và kết
        quả sẽ có ở bước tiếp theo.
      </p>
    </main>
  );
}
