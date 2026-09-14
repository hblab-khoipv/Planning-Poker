'use client';

import type { ParticipantDto } from '@planning-poker/shared';

/**
 * FR-3's list, now fed by the room socket. Each seat carries its own presence
 * (`room_participants.is_online`, PRD §7): somebody who closed their tab stays listed but
 * greyed out, because their seat — and from task 6 their vote — outlives the connection.
 *
 * Each seat also carries its vote status for the current round (FR-3, FR-4). Before the reveal
 * that is a yes/no — "Đã chọn" means a card is in, not which one, which is the whole of PRD §8's
 * `vote:cast` payload. After the reveal the card itself replaces the badge, from the values the
 * server sent with `round:revealed`.
 */

/** 'none' is the read-only view somebody gets before they have joined and taken a seat. */
export type ParticipantListConnection = 'connecting' | 'live' | 'offline' | 'none';

const CONNECTION_LABEL: Record<Exclude<ParticipantListConnection, 'none'>, string> = {
  connecting: 'Đang kết nối…',
  live: 'Trực tiếp',
  offline: 'Mất kết nối',
};

const CONNECTION_STYLE: Record<Exclude<ParticipantListConnection, 'none'>, string> = {
  connecting: 'bg-amber-500/20 text-amber-300',
  live: 'bg-emerald-500/20 text-emerald-300',
  offline: 'bg-rose-500/20 text-rose-300',
};

export function ParticipantList({
  participants,
  currentParticipantId,
  connection = 'none',
  votedParticipantIds,
  revealedVotes = null,
}: {
  participants: ParticipantDto[];
  currentParticipantId: string | null;
  connection?: ParticipantListConnection;
  /** Who has voted in the current round. Never says what they voted. */
  votedParticipantIds?: ReadonlySet<string>;
  /** Card values, present only once the host has revealed. */
  revealedVotes?: ReadonlyMap<string, string> | null;
}) {
  const voted = votedParticipantIds ?? new Set<string>();
  return (
    <section aria-labelledby="participants-heading" className="space-y-3">
      <h2
        id="participants-heading"
        className="flex flex-wrap items-center gap-2 text-xl font-semibold"
      >
        Thành viên{' '}
        <span data-testid="participant-count" className="text-slate-400">
          ({participants.length})
        </span>
        {connection === 'none' ? null : (
          <span
            data-testid="realtime-status"
            data-state={connection}
            className={`rounded px-2 py-0.5 text-xs font-semibold ${CONNECTION_STYLE[connection]}`}
          >
            {CONNECTION_LABEL[connection]}
          </span>
        )}
      </h2>

      {participants.length === 0 ? (
        <p className="text-sm text-slate-400" data-testid="participant-empty">
          Chưa có ai trong phòng.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="participant-list">
          {participants.map((participant) => (
            <li
              key={participant.id}
              data-testid="participant-item"
              data-online={participant.isOnline ? 'true' : 'false'}
              data-voted={voted.has(participant.id) ? 'true' : 'false'}
              className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 ${
                participant.isOnline ? '' : 'opacity-60'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${
                  participant.isOnline ? 'bg-emerald-400' : 'bg-slate-600'
                }`}
              />
              <span className="font-medium text-slate-100">{participant.displayName}</span>
              {participant.isHost ? (
                <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-semibold text-indigo-300">
                  Host
                </span>
              ) : null}
              {participant.isGuest ? (
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  Khách
                </span>
              ) : null}
              {participant.id === currentParticipantId ? (
                <span
                  data-testid="participant-me"
                  className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300"
                >
                  Bạn
                </span>
              ) : null}
              {participant.isOnline ? null : (
                <span
                  data-testid="participant-offline"
                  className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400"
                >
                  Ngoại tuyến
                </span>
              )}

              {/* Vote status sits at the end of the row, and is the only thing that changes
                  shape at the reveal: a badge becomes the card itself. */}
              {revealedVotes ? (
                revealedVotes.has(participant.id) ? (
                  <span
                    data-testid="participant-vote"
                    data-value={revealedVotes.get(participant.id)}
                    className="ml-auto rounded bg-indigo-500/20 px-3 py-0.5 font-mono text-sm font-bold text-indigo-200"
                  >
                    {revealedVotes.get(participant.id)}
                  </span>
                ) : (
                  <span
                    data-testid="participant-no-vote"
                    className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400"
                  >
                    Không vote
                  </span>
                )
              ) : voted.has(participant.id) ? (
                <span
                  data-testid="participant-voted"
                  className="ml-auto rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300"
                >
                  ✓ Đã chọn
                </span>
              ) : (
                <span
                  data-testid="participant-waiting"
                  className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400"
                >
                  Đang chọn…
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
