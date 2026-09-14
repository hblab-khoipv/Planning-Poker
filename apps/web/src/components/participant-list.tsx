'use client';

import type { ParticipantDto } from '@planning-poker/shared';

/**
 * FR-3's list, now fed by the room socket. Each seat carries its own presence
 * (`room_participants.is_online`, PRD §7): somebody who closed their tab stays listed but
 * greyed out, because their seat — and from task 6 their vote — outlives the connection.
 *
 * Vote status is still deliberately absent: no round exists until task 6, and showing
 * "chưa vote" for everybody would be a lie rather than a placeholder.
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
}: {
  participants: ParticipantDto[];
  currentParticipantId: string | null;
  connection?: ParticipantListConnection;
}) {
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
