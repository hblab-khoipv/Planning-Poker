'use client';

import { type ParticipantDto, REACTION_OPTIONS } from '@planning-poker/shared';

/**
 * The emoji palette: one compact row, on purpose.
 *
 * It sits below the deck and takes a single line, because another screen's worth of chrome is
 * exactly what a room that has to fit on one screen cannot afford. Picking a target is a select
 * rather than a second grid of avatars for the same reason — and because a select is reachable
 * by keyboard, which clicking a seat would not be.
 *
 * The palette rendered is `@planning-poker/shared`'s, the same list the server accepts, so the
 * UI cannot offer an emoji that would be refused. Each button carries its Vietnamese label as
 * its accessible name: an emoji on its own reads as nothing useful.
 */
export function ReactionBar({
  participants,
  currentParticipantId,
  targetParticipantId,
  onChangeTarget,
  onThrow,
  disabled = false,
}: {
  participants: ParticipantDto[];
  currentParticipantId: string | null;
  /** null means the table. */
  targetParticipantId: string | null;
  onChangeTarget: (participantId: string | null) => void;
  onThrow: (emoji: string) => void;
  disabled?: boolean;
}) {
  const others = participants.filter((participant) => participant.id !== currentParticipantId);
  const targetName =
    others.find((participant) => participant.id === targetParticipantId)?.displayName ?? null;

  return (
    <section
      aria-labelledby="reactions-heading"
      data-testid="reaction-bar"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
    >
      <h2 id="reactions-heading" className="text-sm font-semibold text-slate-300">
        Ném emoji
      </h2>

      <label className="flex items-center gap-1 text-xs text-slate-400">
        <span className="sr-only">Ném vào</span>
        <select
          data-testid="reaction-target"
          value={targetParticipantId ?? ''}
          disabled={disabled}
          onChange={(event) => onChangeTarget(event.target.value || null)}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 disabled:opacity-40"
        >
          <option value="">Cả bàn</option>
          {others.map((participant) => (
            <option key={participant.id} value={participant.id}>
              {participant.displayName}
            </option>
          ))}
        </select>
      </label>

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
              className="rounded-lg px-1.5 py-0.5 text-xl transition hover:scale-110 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span aria-hidden="true">{option.emoji}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
