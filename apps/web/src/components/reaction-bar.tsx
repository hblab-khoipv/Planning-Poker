'use client';

import { type ParticipantDto, REACTION_OPTIONS } from '@planning-poker/shared';

/**
 * The emoji palette: one compact row, on purpose.
 *
 * It sits in the footer band and takes a single line, because another screen's worth of chrome is
 * exactly what a room that has to fit on one screen cannot afford.
 *
 * Who the emoji is aimed at is *not* chosen here (captain 2026-10-08): you click the person at
 * the table, which is where they are. All this bar keeps is the way back — "Cả bàn" — and a
 * readout of the current target, so nobody can throw a tomato at somebody without the screen
 * having said so first.
 *
 * The palette rendered is `@planning-poker/shared`'s, the same list the server accepts, so the
 * UI cannot offer an emoji that would be refused. Each button carries its Vietnamese label as
 * its accessible name: an emoji on its own reads as nothing useful.
 */
export function ReactionBar({
  participants,
  targetParticipantId,
  onChangeTarget,
  onThrow,
  disabled = false,
}: {
  participants: ParticipantDto[];
  /** null means the table. */
  targetParticipantId: string | null;
  onChangeTarget: (participantId: string | null) => void;
  onThrow: (emoji: string) => void;
  disabled?: boolean;
}) {
  const targetName =
    participants.find((participant) => participant.id === targetParticipantId)?.displayName ?? null;

  return (
    <section
      aria-labelledby="reactions-heading"
      data-testid="reaction-bar"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-1.5"
    >
      <h2 id="reactions-heading" className="text-sm font-semibold text-ink-muted">
        Ném emoji
      </h2>

      <button
        type="button"
        data-testid="reaction-target-all"
        aria-pressed={targetParticipantId === null}
        disabled={disabled}
        onClick={() => onChangeTarget(null)}
        className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40 ${
          targetParticipantId === null
            ? 'border-brand bg-brand text-on-brand'
            : 'border-line-strong bg-surface text-ink hover:border-brand'
        }`}
      >
        Cả bàn
      </button>

      <p data-testid="reaction-target-label" className="text-xs text-ink-subtle">
        {targetName ? (
          <>
            Đang ném vào <span className="font-semibold text-warn-ink">{targetName}</span>
          </>
        ) : (
          'Bấm vào một người ở bàn để ném riêng'
        )}
      </p>

      <ul className="flex flex-wrap items-center gap-1">
        {REACTION_OPTIONS.map((option) => (
          <li key={option.emoji}>
            <button
              type="button"
              data-testid="reaction-button"
              data-emoji={option.emoji}
              title={targetName ? `${option.label} → ${targetName}` : option.label}
              aria-label={targetName ? `${option.label}, ném vào ${targetName}` : option.label}
              disabled={disabled}
              onClick={() => onThrow(option.emoji)}
              className="rounded-lg px-1.5 py-0.5 text-xl transition hover:scale-110 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span aria-hidden="true">{option.emoji}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
