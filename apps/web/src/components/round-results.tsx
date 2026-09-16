'use client';

import type { DeckType, ParticipantDto, RevealedVoteDto, RoundTally } from '@planning-poker/shared';
import { describeChart, voteChartBars } from '@/lib/vote-chart';

/**
 * What the room sees after the host reveals (PRD FR-6, §9.4), as a chart (issue #12).
 *
 * The order is what somebody actually asks after a reveal: *how split are we* (the chart), *what
 * is the number* (average, median, count), and only then *who said what* (the named row list,
 * which FR-6 requires and which the table itself now also shows on each seat).
 *
 * The chart is hand-drawn with Tailwind rather than pulled from a charting library. What is being
 * drawn is a handful of bars whose heights come from `voteChartBars`; a library would add a
 * dependency, a bundle and a second styling system to this app in exchange for axes and tooltips
 * nobody asked for. Every number in the picture is also written next to it as text, so the chart
 * adds a way to read the result rather than replacing the only one there was — that is issue
 * #12's "keep the numbers accessible" made literal.
 */
export function RoundResults({
  participants,
  votesByParticipant,
  tally,
  deckType,
}: {
  participants: readonly ParticipantDto[];
  votesByParticipant: ReadonlyMap<string, RevealedVoteDto>;
  tally: RoundTally;
  deckType: DeckType;
}) {
  const voters = participants.filter((participant) => votesByParticipant.has(participant.id));
  const abstained = participants.filter((participant) => !votesByParticipant.has(participant.id));

  const names = new Map(
    participants.map((participant) => [participant.id, participant.displayName]),
  );
  const bars = voteChartBars(deckType, [...votesByParticipant.values()], names);

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
          🎉 Đồng thuận — cả phòng cùng chọn {votesByParticipant.get(voters[0]?.id ?? '')?.value}
        </p>
      ) : null}

      <div className="flex flex-wrap items-stretch gap-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        {/* The picture. `role="img"` with the whole distribution as its label is what makes it
            readable without sight; the bars themselves are decorative repetitions of the labels
            printed underneath each one. */}
        <div
          data-testid="results-chart"
          role="img"
          aria-label={`Phân bố vote — ${describeChart(bars)}`}
          className="flex min-w-0 flex-1 items-end justify-center gap-4 overflow-x-auto pb-1"
        >
          {bars.map((bar) => (
            <div
              key={bar.value}
              data-testid="results-chart-bar"
              data-value={bar.value}
              data-count={bar.count}
              title={bar.voters.join(', ')}
              className="flex w-14 shrink-0 flex-col items-center gap-2"
            >
              <div className="flex h-28 w-8 items-end" aria-hidden="true">
                <div
                  className={`w-full rounded-full transition-all ${
                    bar.isMode ? 'bg-indigo-400' : 'bg-slate-600'
                  }`}
                  // The one inline style in the component: a bar's height is data, not design,
                  // and Tailwind has no class for "43% of the tallest bar".
                  style={{ height: `${Math.max(6, Math.round(bar.ratio * 100))}%` }}
                />
              </div>
              <span className="font-mono text-lg font-bold text-slate-100">{bar.value}</span>
              <span className="text-xs text-slate-400">{bar.count} vote</span>
            </div>
          ))}
        </div>

        {/* FR-6's numbers, kept beside the chart rather than under it: the reference design in
            issue #12 reads "biểu đồ, rồi con số" left to right. */}
        {tally.average === null ? (
          <dl className="flex shrink-0 flex-col justify-center gap-3" data-testid="results-counts">
            <div>
              <dt className="text-xs uppercase tracking-widest text-slate-400">Số lượt vote</dt>
              <dd className="text-3xl font-bold text-slate-100">{tally.voteCount}</dd>
            </div>
          </dl>
        ) : (
          <dl className="flex shrink-0 flex-col justify-center gap-3" data-testid="results-summary">
            <div>
              <dt className="text-xs uppercase tracking-widest text-slate-400">Trung bình</dt>
              <dd data-testid="results-average" className="text-3xl font-bold text-indigo-300">
                {tally.average}
              </dd>
            </div>
            <div className="flex gap-6">
              <div>
                <dt className="text-xs uppercase tracking-widest text-slate-400">Median</dt>
                <dd data-testid="results-median" className="text-xl font-bold text-slate-100">
                  {tally.median}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-slate-400">Số lượt vote</dt>
                <dd data-testid="results-vote-count" className="text-xl font-bold text-slate-100">
                  {tally.voteCount}
                </dd>
              </div>
            </div>
          </dl>
        )}
      </div>

      {/* FR-6's "bảng vote theo tên". Compact now that the chart carries the shape of the result,
          and carrying issue #11's edit evidence so a changed card is as visible here as it is on
          the table. */}
      <ul className="flex flex-wrap gap-2" data-testid="results-list">
        {voters.map((participant) => {
          const vote = votesByParticipant.get(participant.id) as RevealedVoteDto;
          return (
            <li
              key={participant.id}
              data-testid="result-row"
              data-participant-id={participant.id}
              data-edited={vote.editedAt ? 'true' : 'false'}
              className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
            >
              <span className="text-sm font-medium text-slate-100">{participant.displayName}</span>
              {vote.editedAt ? (
                <>
                  <span
                    data-testid="result-original-value"
                    className="font-mono text-sm text-slate-500 line-through"
                  >
                    {vote.originalValue}
                  </span>
                  <span aria-hidden="true" className="text-slate-500">
                    →
                  </span>
                </>
              ) : null}
              <span
                data-testid="result-value"
                className="rounded bg-indigo-500/20 px-2 py-0.5 font-mono text-base font-bold text-indigo-200"
              >
                {vote.value}
              </span>
              {vote.editedAt ? (
                <span
                  data-testid="result-edited"
                  className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                >
                  đã sửa
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {abstained.length === 0 ? null : (
        <p className="text-sm text-slate-500" data-testid="results-abstained">
          Chưa vote: {abstained.map((participant) => participant.displayName).join(', ')}
        </p>
      )}
    </section>
  );
}
