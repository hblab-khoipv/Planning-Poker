'use client';

import type { ParticipantDto, RevealedVoteDto } from '@planning-poker/shared';
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
  connecting: 'bg-amber-500/20 text-amber-300',
  live: 'bg-emerald-500/20 text-emerald-300',
  offline: 'bg-rose-500/20 text-rose-300',
};

/** The face-down back of a played card — the woven pattern of the reference design. */
const CARD_BACK =
  'bg-[repeating-linear-gradient(45deg,theme(colors.indigo.400)_0px,theme(colors.indigo.400)_6px,theme(colors.indigo.300)_6px,theme(colors.indigo.300)_12px)]';

const CARD_STYLE: Record<SeatCardState, string> = {
  waiting: 'border-slate-700 border-dashed bg-slate-800/60 text-slate-500',
  voted: `border-indigo-300 text-white shadow-lg shadow-indigo-500/20 ${CARD_BACK}`,
  revealed: 'border-slate-200 bg-slate-100 text-slate-900 shadow-lg shadow-slate-900/40',
  'no-vote': 'border-slate-800 border-dashed bg-slate-900 text-slate-600',
};

export function RoomTable({
  participants,
  currentParticipantId,
  connection = 'none',
  votedParticipantIds,
  revealedVotes = null,
  myVote = null,
  isRevealed = false,
  onEditVote,
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
  /** Offered on this browser's own seat only, and only after the reveal (issue #11). */
  onEditVote?: (() => void) | undefined;
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
      onEditVote={onEditVote}
    />
  );

  return (
    <section aria-labelledby="participants-heading" className="space-y-4">
      <h2
        id="participants-heading"
        className="flex flex-wrap items-center gap-2 text-xl font-semibold"
      >
        Bàn estimate{' '}
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
        <div
          data-testid="participant-list"
          className="flex flex-col items-center gap-4 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-6"
        >
          {/* Every edge aligns its seats by the top of the card, so a seat that carries extra
              badges (the reader's own, a host's, an edited one) does not lift its card out of
              line with its neighbours'. */}
          <div className="flex flex-wrap items-start justify-center gap-4">
            {seating.top.map(seat)}
          </div>

          <div className="flex w-full items-center justify-center gap-4">
            <div className="flex flex-col items-center gap-4">{seating.left.map(seat)}</div>

            {/* The table itself. It carries the round's status so the middle of the screen
                answers "what is the room doing right now?" without a legend. */}
            <div
              data-testid="table-surface"
              data-state={isRevealed ? 'revealed' : 'voting'}
              className={`flex min-h-[9rem] w-full max-w-md items-center justify-center rounded-[2.5rem] border-4 px-6 py-8 text-center text-sm font-semibold transition ${
                isRevealed
                  ? 'border-emerald-900/60 bg-emerald-800/70 text-emerald-50'
                  : 'border-slate-800 bg-slate-800/70 text-slate-300'
              }`}
            >
              <span data-testid="table-status">
                {isRevealed ? 'Bài đã lật' : 'Đang chờ mọi người chọn bài…'}
              </span>
            </div>

            <div className="flex flex-col items-center gap-4">{seating.right.map(seat)}</div>
          </div>

          <div className="flex flex-wrap items-start justify-center gap-4">
            {seating.bottom.map(seat)}
          </div>
        </div>
      )}
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
  onEditVote,
}: {
  participant: ParticipantDto;
  hasVoted: boolean;
  revealedVote: RevealedVoteDto | null;
  isRevealed: boolean;
  isMe: boolean;
  myVote: string | null;
  onEditVote?: (() => void) | undefined;
}) {
  const state = seatCardState({
    hasVoted,
    isRevealed,
    hasRevealedValue: revealedVote !== null,
  });
  const edited = revealedVote?.editedAt ? revealedVote : null;
  const face = revealedVote?.value ?? (isMe && !isRevealed ? myVote : null);

  return (
    <div
      data-testid="participant-item"
      data-online={participant.isOnline ? 'true' : 'false'}
      data-voted={hasVoted ? 'true' : 'false'}
      data-card-state={state}
      className={`flex w-28 flex-col items-center gap-1.5 ${participant.isOnline ? '' : 'opacity-50'}`}
    >
      <div className="relative">
        <div
          data-testid="seat-card"
          className={`flex h-24 w-16 items-center justify-center rounded-xl border-2 text-2xl font-bold transition ${
            CARD_STYLE[state]
          } ${isMe ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950' : ''}`}
        >
          {face ?? ''}
        </div>

        {edited ? (
          <span
            data-testid="participant-vote-edited"
            title={`Đã đổi từ ${edited.originalValue ?? '—'} sang ${edited.value}`}
            className="absolute -right-2 -top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950 shadow"
          >
            ✎ đã sửa
          </span>
        ) : null}
      </div>

      {/* The card itself already shows the value; this span is what a screen reader reads, and
          what the e2e specs count. Keeping it in the tree rather than only in an aria-label means
          the state is one string, not two that could drift apart. */}
      {isRevealed ? (
        revealedVote ? (
          <span data-testid="participant-vote" data-value={revealedVote.value} className="sr-only">
            {revealedVote.value}
          </span>
        ) : (
          <span data-testid="participant-no-vote" className="text-[11px] text-slate-500">
            Không vote
          </span>
        )
      ) : hasVoted ? (
        <span data-testid="participant-voted" className="text-[11px] font-semibold text-indigo-300">
          ✓ Đã chọn
        </span>
      ) : (
        <span data-testid="participant-waiting" className="text-[11px] text-slate-500">
          Đang chọn…
        </span>
      )}

      {edited ? (
        <span
          className="flex items-center gap-1 rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-xs text-amber-200"
          data-testid="participant-vote-change"
        >
          <span className="text-slate-400 line-through">{edited.originalValue}</span>
          <span aria-hidden="true">→</span>
          <span className="font-bold">{edited.value}</span>
        </span>
      ) : null}

      <span className="max-w-full truncate text-sm font-medium text-slate-100">
        {participant.displayName}
      </span>

      <span className="flex flex-wrap items-center justify-center gap-1">
        {participant.isHost ? (
          <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
            Host
          </span>
        ) : null}
        {isMe ? (
          <span
            data-testid="participant-me"
            className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
          >
            Bạn
          </span>
        ) : null}
        {participant.isOnline ? null : (
          <span
            data-testid="participant-offline"
            className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
          >
            Ngoại tuyến
          </span>
        )}
      </span>

      {/* Issue #11's edit control. It is rendered on one seat — the one this browser holds — and
          the server refuses any other case regardless, since `vote:edit` has no field for whose
          card to move. */}
      {isMe && isRevealed && onEditVote ? (
        <button
          type="button"
          data-testid="edit-vote-button"
          onClick={onEditVote}
          className="rounded border border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:border-indigo-400 hover:text-indigo-200"
        >
          ✎ Sửa bài
        </button>
      ) : null}
    </div>
  );
}
