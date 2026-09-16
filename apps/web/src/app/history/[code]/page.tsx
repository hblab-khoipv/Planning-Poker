'use client';

import { historyPath, parseRoomCode, type RoomHistoryDetailResponse } from '@planning-poker/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { RoundResults } from '@/components/round-results';
import { fetchRoomHistory, messageForError } from '@/lib/api-client';
import { formatTimestamp, hasResults, votesByParticipantId } from '@/lib/history-format';

/**
 * One room's past rounds — the click-through from PRD §9.6's list.
 *
 * The results are rendered by the very same `RoundResults` the live room uses, from the very same
 * payload shape, so a round read back a week later shows the average, median and consensus badge
 * the room saw at reveal time rather than a second opinion computed here.
 *
 * A round that was never revealed is listed but has no results, because the server sends none:
 * FR-4's secrecy does not lapse once a meeting is over. The screen says so explicitly, so an
 * empty round reads as "nobody turned these over" rather than as a loading failure.
 */
export default function RoomHistoryPage() {
  const params = useParams<{ code: string }>();
  const code = parseRoomCode(typeof params?.code === 'string' ? params.code : '');
  const { status } = useSession();

  const [detail, setDetail] = useState<RoomHistoryDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!code) {
      setError('Mã phòng không hợp lệ.');
      return;
    }

    let cancelled = false;
    setError(null);
    fetchRoomHistory(code)
      .then((found) => {
        if (!cancelled) setDetail(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(messageForError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [code, status]);

  const backLink = (
    <p className="text-sm">
      <Link href={historyPath()} className="font-medium text-indigo-400 hover:underline">
        ← Lịch sử phiên
      </Link>
    </p>
  );

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Không xem được lịch sử</h1>
        <p role="alert" data-testid="room-history-error" className="text-sm text-rose-400">
          {error}
        </p>
        {backLink}
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-16">
        <p data-testid="room-history-loading" className="text-sm text-slate-400">
          Đang tải lịch sử…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-widest text-indigo-400">Lịch sử phòng</p>
        <h1 data-testid="room-history-name" className="text-3xl font-bold tracking-tight">
          {detail.room.name}
        </h1>
        <p className="text-sm text-slate-400">
          Mã phòng: <span className="font-mono">{detail.room.code}</span> · Bộ thẻ:{' '}
          <span data-testid="room-history-deck">{detail.room.deckType}</span> ·{' '}
          <span data-testid="room-history-participants">
            {detail.participants.length} người tham gia
          </span>
        </p>
      </header>

      {detail.rounds.length === 0 ? (
        <p
          data-testid="room-history-no-rounds"
          className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-6 text-sm text-slate-400"
        >
          Phòng này chưa có round nào.
        </p>
      ) : (
        <ol className="space-y-6" data-testid="room-history-rounds">
          {detail.rounds.map((entry) => (
            <li
              key={entry.round.id}
              data-testid="room-history-round"
              data-round-number={entry.round.roundNumber}
              data-round-status={entry.round.status}
              className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-semibold">Round {entry.round.roundNumber}</h2>
                <span className="text-xs text-slate-500" data-testid="round-revealed-at">
                  {entry.round.revealedAt
                    ? `Lật bài lúc ${formatTimestamp(entry.round.revealedAt)}`
                    : 'Chưa lật bài'}
                </span>
              </div>

              {hasResults(entry) ? (
                <RoundResults
                  participants={detail.participants}
                  votesByParticipant={votesByParticipantId(entry)}
                  tally={entry.tally}
                  deckType={detail.room.deckType}
                />
              ) : (
                <p data-testid="round-not-revealed" className="text-sm text-slate-400">
                  Round này kết thúc mà chưa lật bài, nên các lá bài vẫn được giữ kín.
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {backLink}
    </main>
  );
}
