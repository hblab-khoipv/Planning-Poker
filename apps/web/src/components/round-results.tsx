'use client';

import type { ParticipantDto, RoundTally } from '@planning-poker/shared';

/**
 * What the room sees after the host reveals (PRD FR-6, §9.4).
 *
 * Three things, in the order somebody reads them: whether the room agreed, the numbers, and who
 * voted what. The average and median are absent for a t-shirt room rather than shown as "—",
 * because FR-6 scopes them to numeric decks and an empty slot invites the question of what went
 * wrong; the consensus badge works for either deck and stays.
 */
export function RoundResults({
  participants,
  votesByParticipant,
  tally,
}: {
  participants: readonly ParticipantDto[];
  votesByParticipant: ReadonlyMap<string, string>;
  tally: RoundTally;
}) {
  const voters = participants.filter((participant) => votesByParticipant.has(participant.id));
  const abstained = participants.filter((participant) => !votesByParticipant.has(participant.id));

  return (
    <section aria-labelledby="results-heading" className="space-y-4" data-testid="round-results">
      <h2 id="results-heading" className="text-xl font-semibold">
        Kết quả
      </h2>

      {tally.consensus ? (
        <p
          data-testid="results-consensus"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300"
        >
          🎉 Đồng thuận — cả phòng cùng chọn {votesByParticipant.get(voters[0]?.id ?? '')}
        </p>
      ) : null}

      {tally.average === null ? null : (
        <dl className="flex flex-wrap gap-6" data-testid="results-summary">
          <div>
            <dt className="text-xs uppercase tracking-widest text-slate-400">Trung bình</dt>
            <dd data-testid="results-average" className="text-2xl font-bold text-slate-100">
              {tally.average}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-widest text-slate-400">Median</dt>
            <dd data-testid="results-median" className="text-2xl font-bold text-slate-100">
              {tally.median}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-widest text-slate-400">Số lượt vote</dt>
            <dd data-testid="results-vote-count" className="text-2xl font-bold text-slate-100">
              {tally.voteCount}
            </dd>
          </div>
        </dl>
      )}

      <ul className="space-y-2" data-testid="results-list">
        {voters.map((participant) => (
          <li
            key={participant.id}
            data-testid="result-row"
            data-participant-id={participant.id}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3"
          >
            <span className="font-medium text-slate-100">{participant.displayName}</span>
            <span
              data-testid="result-value"
              className="rounded bg-indigo-500/20 px-3 py-1 font-mono text-lg font-bold text-indigo-200"
            >
              {votesByParticipant.get(participant.id)}
            </span>
          </li>
        ))}
      </ul>

      {abstained.length === 0 ? null : (
        <p className="text-sm text-slate-500" data-testid="results-abstained">
          Chưa vote: {abstained.map((participant) => participant.displayName).join(', ')}
        </p>
      )}
    </section>
  );
}
