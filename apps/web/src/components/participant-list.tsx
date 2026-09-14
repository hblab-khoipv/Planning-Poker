'use client';

import type { ParticipantDto } from '@planning-poker/shared';

/**
 * FR-3's list, minus the realtime transport. Vote status is deliberately absent: no round exists
 * until task 5/6, and showing "chưa vote" for everybody would be a lie rather than a placeholder.
 */
export function ParticipantList({
  participants,
  currentParticipantId,
}: {
  participants: ParticipantDto[];
  currentParticipantId: string | null;
}) {
  return (
    <section aria-labelledby="participants-heading" className="space-y-3">
      <h2 id="participants-heading" className="text-xl font-semibold">
        Thành viên{' '}
        <span data-testid="participant-count" className="text-slate-400">
          ({participants.length})
        </span>
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
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3"
            >
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
