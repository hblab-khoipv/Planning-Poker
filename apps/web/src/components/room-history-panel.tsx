'use client';

import type { RoomHistoryDetailResponse, RoundHistoryEntryDto } from '@planning-poker/shared';
import { useCallback, useEffect, useState } from 'react';
import { fetchRoomHistory, messageForError } from '@/lib/api-client';
import { formatTimestamp } from '@/lib/history-format';
import { copyText, type ExportFormat, downloadFile, roomSummaryFile } from '@/lib/room-export';

/**
 * The room's own score history, and the export of it.
 *
 * Collapsed by default and rendered inside a `<details>`: the room screen is meant to fit one
 * screen, so a panel that is usually shut costs a single line of height and the browser handles
 * the toggle without any state of ours. Nothing is fetched until it is opened for the first time.
 *
 * It reads `GET /rooms/:code/rounds` — the same endpoint the history screens use, which means the
 * same secrecy rule: a round still `voting` arrives with no cards, so the panel cannot show the
 * current round's votes to somebody who scrolls down mid-vote. `participantId` is the seat this
 * browser holds, which is what lets a guest open it at all (see `apps/api/src/http/history.ts`).
 *
 * `refreshKey` is how the live room tells the panel that something it lists has changed — a
 * reveal, a new round, a story typed. Refetching beats patching a second copy of the round state
 * into this component: there is one source for what the history says, and it is the server.
 */
export function RoomHistoryPanel({
  code,
  participantId,
  refreshKey,
}: {
  code: string;
  participantId: string | null;
  refreshKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<RoomHistoryDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);
    fetchRoomHistory(code, { participantId })
      .then((found) => {
        if (!cancelled) setDetail(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(messageForError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [code, participantId, open, refreshKey]);

  const onExport = useCallback(
    (format: ExportFormat) => {
      if (!detail) return;
      downloadFile(roomSummaryFile(detail, format));
    },
    [detail],
  );

  const onCopyMarkdown = useCallback(() => {
    if (!detail) return;
    void copyText(roomSummaryFile(detail, 'md').content).then((ok) => {
      setCopied(
        ok ? 'Đã copy tổng kết vào clipboard.' : 'Trình duyệt không cho copy — hãy tải file.',
      );
    });
  }, [detail]);

  const rounds = detail?.rounds ?? [];
  const names = new Map((detail?.participants ?? []).map((seat) => [seat.id, seat.displayName]));

  return (
    <details
      data-testid="room-history-panel"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="rounded-xl border border-slate-800 bg-slate-900/60"
    >
      <summary
        data-testid="room-history-toggle"
        className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-200 hover:text-indigo-300"
      >
        Lịch sử round &amp; xuất tổng kết
      </summary>

      <div className="space-y-3 border-t border-slate-800 px-4 py-4">
        {error ? (
          <p role="alert" data-testid="room-history-panel-error" className="text-sm text-rose-400">
            {error}
          </p>
        ) : null}

        {!error && !detail ? (
          <p className="text-sm text-slate-400" data-testid="room-history-panel-loading">
            Đang tải lịch sử…
          </p>
        ) : null}

        {detail ? (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="export-csv-button"
                onClick={() => onExport('csv')}
                className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400"
              >
                Tải CSV
              </button>
              <button
                type="button"
                data-testid="export-md-button"
                onClick={() => onExport('md')}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-indigo-500"
              >
                Tải Markdown
              </button>
              <button
                type="button"
                data-testid="copy-md-button"
                onClick={onCopyMarkdown}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:border-indigo-500"
              >
                Copy tổng kết
              </button>
            </div>

            {copied ? (
              <p data-testid="export-copied" role="status" className="text-xs text-emerald-300">
                {copied}
              </p>
            ) : null}

            {rounds.length === 0 ? (
              <p data-testid="room-history-panel-empty" className="text-sm text-slate-400">
                Phòng này chưa có round nào.
              </p>
            ) : (
              // Capped height rather than a growing list: the panel must not push the room off
              // one screen once a long session has twenty rounds in it.
              <ul
                data-testid="room-history-panel-rounds"
                className="max-h-64 space-y-2 overflow-y-auto pr-1"
              >
                {rounds.map((entry) => (
                  <RoundRow key={entry.round.id} entry={entry} names={names} />
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </details>
  );
}

/** One line of history: what was estimated, what the room decided, and who said what. */
function RoundRow({
  entry,
  names,
}: {
  entry: RoundHistoryEntryDto;
  names: ReadonlyMap<string, string>;
}) {
  const stamp = entry.round.revealedAt ?? entry.round.createdAt;

  return (
    <li
      data-testid="room-history-panel-round"
      data-round-number={entry.round.roundNumber}
      data-round-status={entry.round.status}
      className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-slate-100">#{entry.round.roundNumber}</span>
        <span data-testid="panel-round-story" className="min-w-0 flex-1 truncate text-slate-300">
          {entry.round.story ?? <span className="text-slate-500">Chưa đặt tên story</span>}
        </span>
        <span className="text-xs text-slate-500">{formatTimestamp(stamp)}</span>
      </div>

      {entry.tally === null ? (
        <p data-testid="panel-round-hidden" className="mt-1 text-xs text-slate-500">
          Chưa lật bài — các lá bài vẫn được giữ kín.
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {entry.tally.average === null ? null : (
            <span data-testid="panel-round-average" className="font-semibold text-indigo-300">
              TB {entry.tally.average}
            </span>
          )}
          {entry.tally.median === null ? null : (
            <span className="text-slate-400">Median {entry.tally.median}</span>
          )}
          <span className="text-slate-400">{entry.tally.voteCount} vote</span>
          {entry.tally.consensus ? (
            <span data-testid="panel-round-consensus" className="text-emerald-300">
              🎉 Đồng thuận
            </span>
          ) : null}
          <span className="min-w-0 basis-full truncate text-slate-500">
            {entry.votes
              .map((vote) => `${names.get(vote.participantId) ?? '?'}: ${vote.value}`)
              .join(' · ')}
          </span>
        </div>
      )}
    </li>
  );
}
