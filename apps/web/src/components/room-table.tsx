'use client';

import type { ParticipantDto, RevealedVoteDto } from '@planning-poker/shared';
import type { ReactNode } from 'react';
import { SeatReactions, TableReactions } from '@/components/reaction-fx';
import { type LiveReaction, seatReactions, tableReactions } from '@/lib/reactions';
import { arrangeSeats, type SeatCardState, seatCardState } from '@/lib/table-seats';

/**
 * The room as a table seen from above (issue #11).
 *
 * This replaces FR-3's plain list. What it shows is exactly what the list showed — who is here,
 * who is online, who has played a card and, after the reveal, which one — so nothing about the
 * secrecy of FR-4 changes: before the reveal a seat's card is a colour and nothing else, and the
 * only value this component can render for somebody else is one the server already published in
 * `round:revealed`.
 *
 * Three things the picture says that the list could not:
 *
 * - **Where the host sits.** The host faces the room from the near edge (`arrangeSeats`).
 * - **Who the room is waiting for.** A grey card is somebody still thinking; a coloured one is a
 *   card already in. That is issue #11's colour rule, and it is the same yes/no the list showed
 *   as "Đã chọn".
 * - **Who changed their mind after the cards were up.** An edited seat keeps the card the room
 *   first saw, struck through beside the new one, plus a badge — the "evidence" issue #11 asks
 *   for. It is only ever shown post-reveal, because that is the only time the old card is public.
 *
 * Colour alone carries none of this: every state also has a text label (visually hidden where the
 * card itself already says it), which is what keeps the screen readable to a screen reader and to
 * anyone who cannot tell the grey card from the indigo one.
 */

/** 'none' is the read-only view somebody gets before they have joined and taken a seat. */
export type RoomTableConnection = 'connecting' | 'live' | 'offline' | 'none';

const CONNECTION_LABEL: Record<Exclude<RoomTableConnection, 'none'>, string> = {
  connecting: 'Đang kết nối…',
  live: 'Trực tiếp',
  offline: 'Mất kết nối',
};

const CONNECTION_STYLE: Record<Exclude<RoomTableConnection, 'none'>, string> = {
  connecting: 'bg-warn/15 text-warn-ink',
  live: 'bg-ok/10 text-ok-ink',
  offline: 'bg-danger/10 text-danger-ink',
};

/** The face-down back of a played card — the woven pattern of the reference design. */
const CARD_BACK =
  'bg-[repeating-linear-gradient(45deg,rgb(var(--brand))_0px,rgb(var(--brand))_6px,rgb(var(--brand-strong))_6px,rgb(var(--brand-strong))_12px)]';

const CARD_STYLE: Record<SeatCardState, string> = {
  waiting: 'border-line-strong border-dashed bg-surface-2 text-ink-subtle',
  voted: `border-brand text-on-brand shadow-md shadow-brand/20 ${CARD_BACK}`,
  revealed: 'border-brand bg-card-face text-card-face-ink shadow-md shadow-ink/10',
  'no-vote': 'border-line border-dashed bg-surface text-ink-subtle',
};

export function RoomTable({
  participants,
  currentParticipantId,
  connection = 'none',
  votedParticipantIds,
  revealedVotes = null,
  myVote = null,
  isRevealed = false,
  reactions = [],
  onEditVote,
  reactionTargetId = null,
  onSelectReactionTarget,
  footer,
}: {
  participants: ParticipantDto[];
  currentParticipantId: string | null;
  connection?: RoomTableConnection;
  /** Who has voted in the current round. Never says what they voted. */
  votedParticipantIds?: ReadonlySet<string>;
  /** Cards, present only once the host has revealed. */
  revealedVotes?: ReadonlyMap<string, RevealedVoteDto> | null;
  /** This browser's own card, which it may see before anybody else does. */
  myVote?: string | null;
  isRevealed?: boolean;
  /** Emoji currently in flight. Drawn over the table and the seats, never into their layout. */
  reactions?: LiveReaction[];
  /** Offered on this browser's own seat only, and only after the reveal (issue #11). */
  onEditVote?: (() => void) | undefined;
  /** Whose seat the next emoji is aimed at; null is the whole table. */
  reactionTargetId?: string | null;
  /** Present only for somebody holding a seat: a seat then becomes the emoji target picker. */
  onSelectReactionTarget?: ((participantId: string | null) => void) | undefined;
  /** The deck and the host's controls, inside the frame below the seats (captain 2026-10-08). */
  footer?: ReactNode;
}) {
  const voted = votedParticipantIds ?? new Set<string>();
  const seating = arrangeSeats(participants);

  const seat = (participant: ParticipantDto) => (
    <Seat
      key={participant.id}
      participant={participant}
      hasVoted={voted.has(participant.id)}
      revealedVote={revealedVotes?.get(participant.id) ?? null}
      isRevealed={isRevealed}
      isMe={participant.id === currentParticipantId}
      myVote={myVote}
      reactions={seatReactions(reactions, participant.id)}
      onEditVote={onEditVote}
      isReactionTarget={participant.id === reactionTargetId}
      onSelectReactionTarget={onSelectReactionTarget}
    />
  );

  return (
    <section
      aria-labelledby="participants-heading"
      className="flex min-h-0 flex-1 flex-col gap-2"
      data-testid="room-table"
    >
      <h2
        id="participants-heading"
        className="flex flex-wrap items-center gap-2 text-base font-semibold"
      >
        Bàn estimate{' '}
        <span data-testid="participant-count" className="text-ink-muted">
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

      {/*
        One frame, one size. The border below is the "Bàn estimate" panel the captain asked to
        stop moving: it is `flex-1` inside a screen-height column, so it is the same box before
        and after the reveal, with 1 seat or with 30 and with the deck in it. Everything that can
        change size — the seat list, the empty state — lives *inside* it and scrolls, and the
        results rail opposite is reserved whether or not there are results yet (see the page).
      */}
      <div
        data-testid="table-frame"
        className="flex h-[26rem] min-h-0 flex-col gap-2 rounded-2xl border border-line bg-surface px-3 py-3 lg:h-auto lg:flex-1"
      >
        {participants.length === 0 ? (
          <p
            className="flex flex-1 items-center justify-center text-sm text-ink-muted"
            data-testid="participant-empty"
          >
            Chưa có ai trong phòng.
          </p>
        ) : (
          <div
            data-testid="participant-list"
            className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-auto [justify-content:safe_center] lg:gap-3"
          >
            {/* Every edge aligns its seats by the top of the card, so a seat that carries extra
                badges (the reader's own, a host's, an edited one) does not lift its card out of
                line with its neighbours'. */}
            <div className="flex flex-wrap items-start justify-center gap-2 lg:gap-3">
              {seating.top.map(seat)}
            </div>

            <div className="flex w-full items-center justify-center gap-2 lg:gap-3">
              <div className="flex flex-col items-center gap-2 lg:gap-3">
                {seating.left.map(seat)}
              </div>

              {/* The table itself. It carries the round's status so the middle of the screen
                  answers "what is the room doing right now?" without a legend. */}
              <div
                data-testid="table-surface"
                data-state={isRevealed ? 'revealed' : 'voting'}
                className={`relative flex min-h-[4.5rem] w-full max-w-xs items-center justify-center overflow-hidden rounded-[2rem] border-4 px-4 py-4 text-center text-sm font-semibold transition lg:min-h-[6rem] ${
                  isRevealed
                    ? 'border-ok/40 bg-felt text-felt-ink'
                    : 'border-line bg-surface-2 text-ink-muted'
                }`}
              >
                <span data-testid="table-status">
                  {isRevealed ? 'Bài đã lật' : 'Đang chờ mọi người chọn bài…'}
                </span>
                <TableReactions reactions={tableReactions(reactions)} />
              </div>

              <div className="flex flex-col items-center gap-2 lg:gap-3">
                {seating.right.map(seat)}
              </div>
            </div>

            <div className="flex flex-wrap items-start justify-center gap-2 lg:gap-3">
              {seating.bottom.map(seat)}
            </div>
          </div>
        )}

        {/* The hand, inside the table rather than under it (captain 2026-10-08): you pick your
            card at the table you are sitting at. It never grows the frame — it is `shrink-0`
            and the seat list above it is the one thing that gives way. */}
        {footer ? (
          <div data-testid="table-footer" className="shrink-0 border-t border-line pt-2">
            {footer}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One person's place at the table: their card, their name, and the badges that qualify it.
 *
 * The card's face is decided in one place — `seatCardState` plus `revealedVote` — so there is no
 * branch here that could print a value the round is not ready to publish. The one value shown
 * ahead of the reveal is `myVote`, and only on this browser's own seat, which is the same
 * exception the server already makes for `room:state.myVote`.
 */
function Seat({
  participant,
  hasVoted,
  revealedVote,
  isRevealed,
  isMe,
  myVote,
  reactions,
  onEditVote,
  isReactionTarget,
  onSelectReactionTarget,
}: {
  participant: ParticipantDto;
  hasVoted: boolean;
  revealedVote: RevealedVoteDto | null;
  isRevealed: boolean;
  isMe: boolean;
  myVote: string | null;
  reactions: LiveReaction[];
  onEditVote?: (() => void) | undefined;
  isReactionTarget: boolean;
  onSelectReactionTarget?: ((participantId: string | null) => void) | undefined;
}) {
  const state = seatCardState({
    hasVoted,
    isRevealed,
    hasRevealedValue: revealedVote !== null,
  });
  const edited = revealedVote?.editedAt ? revealedVote : null;
  const face = revealedVote?.value ?? (isMe && !isRevealed ? myVote : null);

  /*
   * Picking who the next emoji is aimed at is the seat itself (captain 2026-10-08), replacing
   * the select that used to sit in the emoji bar: at a table you throw at a person, not at a
   * name in a list. It is a real <button>, so Tab reaches it and Enter/Space press it, and
   * `aria-pressed` is what says it is currently the target — the amber ring alone would say it
   * to nobody using a screen reader. Clicking the chosen seat again goes back to the whole table.
   *
   * The seat body is the button's content rather than an overlay, because an overlay would swallow
   * the "Sửa bài" click underneath it; that button stays outside, since a button inside a button
   * is not a thing a browser will render.
   */
  const Body = onSelectReactionTarget ? 'button' : 'div';
  const targeting = onSelectReactionTarget
    ? ({
        type: 'button' as const,
        'aria-pressed': isReactionTarget,
        onClick: () => onSelectReactionTarget(isReactionTarget ? null : participant.id),
        className: `relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-1 transition hover:bg-brand/5 ${
          isReactionTarget ? 'bg-warn/15 ring-2 ring-warn' : ''
        }`,
      } as const)
    : ({ className: 'relative flex w-full flex-col items-center gap-1 px-1 py-1' } as const);

  return (
    <div
      data-testid="participant-item"
      data-online={participant.isOnline ? 'true' : 'false'}
      data-voted={hasVoted ? 'true' : 'false'}
      data-card-state={state}
      data-reaction-target={isReactionTarget ? 'true' : 'false'}
      /* `relative` is load-bearing: a `.sr-only` span is `position: absolute`, and one whose
         containing block is outside the seat list escapes that list's clipping and makes the
         whole page scrollable by a few pixels — which is exactly the one-screen rule the layout
         spec guards. Keeping the seat itself positioned keeps those spans inside it. */
      className={`relative flex w-[4.5rem] flex-col items-center gap-1 lg:w-20 ${participant.isOnline ? '' : 'opacity-60'}`}
    >
      <Body data-testid="seat-target" {...targeting}>
        <div className="relative">
          <div
            data-testid="seat-card"
            className={`flex h-14 w-10 items-center justify-center rounded-lg border-2 text-lg font-bold transition lg:h-[4.5rem] lg:w-12 lg:text-xl ${
              CARD_STYLE[state]
            } ${isMe ? 'ring-2 ring-ok ring-offset-2 ring-offset-surface' : ''}`}
          >
            {face ?? ''}
          </div>

          {edited ? (
            <span
              data-testid="participant-vote-edited"
              title={`Đã đổi từ ${edited.originalValue ?? '—'} sang ${edited.value}`}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-warn px-1.5 py-0.5 text-[9px] font-bold text-on-warn shadow"
            >
              <span aria-hidden="true">✎</span>
              <span className="sr-only">đã sửa</span>
            </span>
          ) : null}

          <SeatReactions reactions={reactions} />
        </div>

        {/* The card itself already shows the value; this span is what a screen reader reads, and
          what the e2e specs count. Keeping it in the tree rather than only in an aria-label means
          the state is one string, not two that could drift apart. */}
        {isRevealed ? (
          revealedVote ? (
            <span
              data-testid="participant-vote"
              data-value={revealedVote.value}
              className="sr-only"
            >
              {revealedVote.value}
            </span>
          ) : (
            <span data-testid="participant-no-vote" className="text-[11px] text-ink-subtle">
              Không vote
            </span>
          )
        ) : hasVoted ? (
          <span
            data-testid="participant-voted"
            className="text-[11px] font-semibold text-brand-ink"
          >
            ✓ Đã chọn
          </span>
        ) : (
          <span data-testid="participant-waiting" className="text-[11px] text-ink-subtle">
            Đang chọn…
          </span>
        )}

        {edited ? (
          <span
            className="flex items-center gap-1 rounded bg-warn/15 px-1.5 py-0.5 font-mono text-xs text-warn-ink"
            data-testid="participant-vote-change"
          >
            <span className="text-ink-muted line-through">{edited.originalValue}</span>
            <span aria-hidden="true">→</span>
            <span className="font-bold">{edited.value}</span>
          </span>
        ) : null}

        <span className="max-w-full truncate text-xs font-medium text-ink lg:text-sm">
          {participant.displayName}
        </span>

        <span className="flex flex-wrap items-center justify-center gap-1">
          {participant.isHost ? (
            <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-ink">
              Host
            </span>
          ) : null}
          {isMe ? (
            <span
              data-testid="participant-me"
              className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] font-semibold text-ok-ink"
            >
              Bạn
            </span>
          ) : null}
          {participant.isOnline ? null : (
            <span
              data-testid="participant-offline"
              className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-muted"
            >
              Ngoại tuyến
            </span>
          )}
        </span>

        {onSelectReactionTarget ? (
          <span className="sr-only">
            {isReactionTarget
              ? `Đang ném emoji vào ${participant.displayName}. Bấm để ném cả bàn.`
              : `Chọn ${participant.displayName} làm mục tiêu ném emoji`}
          </span>
        ) : null}
      </Body>

      {/* Issue #11's edit control. It is rendered on one seat — the one this browser holds — and
          the server refuses any other case regardless, since `vote:edit` has no field for whose
          card to move. */}
      {isMe && isRevealed && onEditVote ? (
        <button
          type="button"
          data-testid="edit-vote-button"
          onClick={onEditVote}
          className="rounded border border-line-strong px-2 py-0.5 text-[11px] font-semibold text-ink hover:border-brand hover:text-brand-ink"
        >
          ✎ Sửa bài
        </button>
      ) : null}
    </div>
  );
}
