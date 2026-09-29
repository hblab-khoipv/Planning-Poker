'use client';

import {
  type ActionAck,
  joinPath,
  type ParticipantDto,
  type ParticipantJoinedPayload,
  type ParticipantLeftPayload,
  parseRoomCode,
  type RoomDto,
  type RevealedVoteDto,
  type ReactionThrownPayload,
  type RoomStatePayload,
  type RoundDto,
  type RoundResetPayload,
  type RoundRevealedPayload,
  type RoundTally,
  type RoundUpdatedPayload,
  type VoteCastPayload,
  type VoteEditedPayload,
} from '@planning-poker/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InviteLink } from '@/components/invite-link';
import { ReactionBar } from '@/components/reaction-bar';
import { RoomHistoryPanel } from '@/components/room-history-panel';
import { RoomTable } from '@/components/room-table';
import { RoundResults } from '@/components/round-results';
import { RoundStory } from '@/components/round-story';
import { VoteDeck } from '@/components/vote-deck';
import { fetchParticipants, fetchRoom, messageForError } from '@/lib/api-client';
import { browserIdentityStore } from '@/lib/guest-identity';
import { applyReactionThrown, type LiveReaction, pruneReactions } from '@/lib/reactions';
import { readRoomMembership } from '@/lib/room-membership';
import {
  applyParticipantJoined,
  applyParticipantLeft,
  applyVoteCast,
  castVote,
  connectToRoom,
  editVote,
  messageForActionError,
  resetRound,
  revealRound,
  type RoomSocket,
  setRoundStory,
  SOCKET_EVENTS,
  throwReaction,
  votesByParticipant,
} from '@/lib/room-socket';

/**
 * The room screen (PRD §9.4): identity, invite link, live participant list, the deck, the host's
 * controls and the results (PRD §4 steps 5–8).
 *
 * Two ways in, on purpose. Somebody who has joined holds a seat, so they open a socket and every
 * piece of state below is pushed. Somebody who only followed the invite link has no seat yet; the
 * API refuses them a socket (a connection may never invent a participant), so they get a single
 * REST read and a prompt to join.
 *
 * The page never derives what anybody voted. Before the reveal it knows a set of ids and nothing
 * else, because that is all `vote:cast` carries; card values exist here only after
 * `round:revealed` has delivered them, and `myVote` — this browser's own card — comes from the
 * private `room:state` snapshot so a reload does not lose a selection.
 */

type ConnectionState = 'connecting' | 'live' | 'offline';

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = parseRoomCode(typeof params?.code === 'string' ? params.code : '');

  const [room, setRoom] = useState<RoomDto | null>(null);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mySeatId, setMySeatId] = useState<string | null>(null);
  const [seatChecked, setSeatChecked] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  const [round, setRound] = useState<RoundDto | null>(null);
  const [votedIds, setVotedIds] = useState<ReadonlySet<string>>(new Set());
  const [revealed, setRevealed] = useState<{
    votes: Map<string, RevealedVoteDto>;
    tally: RoundTally;
  } | null>(null);
  // Bumped whenever the revealed cards are replaced, so the history panel refetches on an edit.
  const [votesVersion, setVotesVersion] = useState(0);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * Whether this browser has asked to change its own card after the reveal (issue #11).
   *
   * The deck is locked once the cards are up, and this is the one thing that unlocks it — for
   * this browser, for its own seat. It is local state rather than anything the server knows,
   * because nobody else has any business seeing that somebody is *considering* a change; what
   * the room learns is the change itself, once it is made.
   */
  const [editingVote, setEditingVote] = useState(false);

  /**
   * Emoji currently in flight, and who the next one is aimed at (null = the table).
   *
   * Entirely local and entirely ephemeral: the server keeps nothing, so a reload simply starts
   * from an empty table. Nothing here feeds the round state, which is what lets the room throw
   * tomatoes through a reveal without disturbing it.
   */
  const [reactions, setReactions] = useState<readonly LiveReaction[]>([]);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [reactionError, setReactionError] = useState<string | null>(null);

  // Held in a ref rather than state: the handlers need the live socket, and re-rendering when it
  // changes would tear the room's event subscriptions down mid-round.
  const socketRef = useRef<RoomSocket | null>(null);

  useEffect(() => {
    if (!code) return;
    const store = browserIdentityStore();
    setMySeatId(store ? readRoomMembership(store, code) : null);
    setSeatChecked(true);
  }, [code]);

  useEffect(() => {
    if (!code) {
      setError('Mã phòng không hợp lệ.');
      return;
    }

    let cancelled = false;
    fetchRoom(code)
      .then(({ room: found }) => {
        if (!cancelled) setRoom(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(messageForError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!code || !seatChecked) return;

    let cancelled = false;

    if (!mySeatId) {
      setConnection('offline');
      void fetchParticipants(code)
        .then(({ participants: current }) => {
          if (!cancelled) setParticipants(current);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

    setConnection('connecting');
    const socket = connectToRoom({ roomCode: code, participantId: mySeatId });
    socketRef.current = socket;

    socket.on('connect', () => setConnection('live'));
    socket.on('disconnect', () => setConnection('connecting'));
    socket.on('connect_error', () => setConnection('offline'));

    // The snapshot is authoritative for everything, so a reconnection mid-round restores the
    // whole screen — including which card this browser had already chosen.
    socket.on(SOCKET_EVENTS.ROOM_STATE, (payload: RoomStatePayload) => {
      setParticipants(payload.participants);
      setRound(payload.round);
      setVotedIds(new Set(payload.votedParticipantIds));
      setMyVote(payload.myVote);
      setRevealed(
        payload.tally ? { votes: votesByParticipant(payload.votes), tally: payload.tally } : null,
      );
      setVotesVersion((current) => current + 1);
    });
    socket.on(SOCKET_EVENTS.PARTICIPANT_JOINED, (payload: ParticipantJoinedPayload) => {
      setParticipants((current) => applyParticipantJoined(current, payload.participant));
    });
    socket.on(SOCKET_EVENTS.PARTICIPANT_LEFT, (payload: ParticipantLeftPayload) => {
      setParticipants((current) => applyParticipantLeft(current, payload.participantId));
    });

    // All this event carries is "somebody voted" — there is no value in it to display.
    socket.on(SOCKET_EVENTS.VOTE_CAST, (payload: VoteCastPayload) => {
      setVotedIds((current) => applyVoteCast(current, payload.participantId));
    });

    socket.on(SOCKET_EVENTS.ROUND_REVEALED, (payload: RoundRevealedPayload) => {
      setRound(payload.round);
      setVotedIds(new Set(payload.votes.map((vote) => vote.participantId)));
      setRevealed({ votes: votesByParticipant(payload.votes), tally: payload.tally });
      setEditingVote(false);
    });

    // Issue #11: somebody changed their card after the reveal. The payload carries the round's
    // whole state, so this is a replacement rather than a patch — which is what makes it safe to
    // apply twice, or out of order with another edit.
    socket.on(SOCKET_EVENTS.VOTE_EDITED, (payload: VoteEditedPayload) => {
      setRound(payload.round);
      setRevealed({ votes: votesByParticipant(payload.votes), tally: payload.tally });
      setVotesVersion((current) => current + 1);
      if (payload.participantId === mySeatId) {
        const mine = payload.votes.find((vote) => vote.participantId === mySeatId);
        setMyVote(mine?.value ?? null);
        setEditingVote(false);
      }
    });

    socket.on(SOCKET_EVENTS.REACTION_THROWN, (payload: ReactionThrownPayload) => {
      // `Date.now()` rather than the payload's own clock: expiry is measured on this screen, so
      // a browser whose clock is off by an hour still shows the emoji for the right two seconds.
      setReactions((current) =>
        applyReactionThrown(current, { ...payload, thrownAt: Date.now() }, Date.now()),
      );
    });

    // Only the round's own fields moved (its story), so nothing about the votes is touched.
    socket.on(SOCKET_EVENTS.ROUND_UPDATED, (payload: RoundUpdatedPayload) => {
      setRound(payload.round);
    });

    // A reset clears every trace of the previous round, this browser's own card included.
    socket.on(SOCKET_EVENTS.ROUND_RESET, (payload: RoundResetPayload) => {
      setRound(payload.round);
      setVotedIds(new Set());
      setRevealed(null);
      setMyVote(null);
      setActionError(null);
      setEditingVote(false);
    });

    return () => {
      cancelled = true;
      socketRef.current = null;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [code, mySeatId, seatChecked]);

  // One timer for the whole list: an emoji leaves the DOM as its animation ends, and a quiet
  // room costs nothing because `pruneReactions` returns the same array when nothing expired.
  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = setInterval(
      () => setReactions((current) => pruneReactions(current, Date.now())),
      400,
    );
    return () => clearInterval(timer);
  }, [reactions.length]);

  // A seat that leaves the room stops being a valid target, so the picker falls back to the table.
  useEffect(() => {
    if (reactionTarget && !participants.some((p) => p.id === reactionTarget)) {
      setReactionTarget(null);
    }
  }, [participants, reactionTarget]);

  const mySeat = useMemo(
    () => participants.find((participant) => participant.id === mySeatId) ?? null,
    [participants, mySeatId],
  );
  const isHost = mySeat?.isHost ?? false;
  const isRevealed = round?.status === 'revealed';

  /** Every action follows the same shape: send, then show whatever the server refused. */
  const runAction = useCallback(
    async (action: (socket: RoomSocket) => Promise<ActionAck>): Promise<boolean> => {
      const socket = socketRef.current;
      if (!socket) return false;

      const ack = await action(socket);
      setActionError(messageForActionError(ack));
      return ack.ok;
    },
    [],
  );

  const onSelectCard = useCallback(
    (value: string) => {
      // After the reveal the same click means something different — a public correction rather
      // than a private choice — so it goes out as a different event. The screen does not decide
      // whether that is allowed; the server does, and refuses anything else.
      if (isRevealed) {
        void runAction((socket) => editVote(socket, value)).then((ok) => {
          if (ok) setEditingVote(false);
        });
        return;
      }

      // Optimistic: the card lights up immediately and is corrected by `room:state` if the
      // server refuses it, which keeps a deliberately quick interaction quick.
      const previous = myVote;
      setMyVote(value);
      void runAction((socket) => castVote(socket, value)).then((ok) => {
        if (!ok) setMyVote(previous);
      });
    },
    [isRevealed, myVote, runAction],
  );

  /** Issue #11: unlock the deck for this browser's own card, on a round already revealed. */
  const onStartEditingVote = useCallback(() => {
    setEditingVote(true);
    setActionError(null);
  }, []);

  // Its own error state, not `runAction`'s: a throw must never clear or overwrite a vote,
  // reveal or edit refusal, and a refused throw does not belong in the room's main alert.
  const onThrowReaction = useCallback(
    (emoji: string) => {
      const socket = socketRef.current;
      if (!socket) return;
      void throwReaction(socket, emoji, reactionTarget).then((ack) =>
        setReactionError(messageForActionError(ack)),
      );
    },
    [reactionTarget],
  );

  const onSetStory = useCallback(
    (story: string) => void runAction((socket) => setRoundStory(socket, story)),
    [runAction],
  );

  const onReveal = useCallback(() => void runAction(revealRound), [runAction]);
  const onReset = useCallback(() => void runAction(resetRound), [runAction]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Không mở được phòng</h1>
        <p role="alert" data-testid="room-error" className="text-sm text-rose-400">
          {error}
        </p>
        <Link href="/join" className="text-sm font-medium text-indigo-400 hover:underline">
          ← Nhập lại mã phòng
        </Link>
      </main>
    );
  }

  if (!room || !code) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-6 py-16">
        <p className="text-sm text-slate-400" data-testid="room-loading">
          Đang tải phòng…
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-widest text-indigo-400">Phòng estimate</p>
        <h1 data-testid="room-name" className="text-3xl font-bold tracking-tight">
          {room.name}
        </h1>
        <p className="text-sm text-slate-400">
          Mã phòng:{' '}
          <span data-testid="room-code" className="font-mono">
            {room.code}
          </span>{' '}
          · Bộ thẻ: <span data-testid="room-deck-type">{room.deckType}</span>
        </p>
        {round ? (
          <>
            <p className="text-sm text-slate-400">
              Round <span data-testid="round-number">{round.roundNumber}</span> ·{' '}
              <span data-testid="round-status" data-state={round.status}>
                {isRevealed ? 'Đã lật bài' : 'Đang vote'}
              </span>
            </p>
            <RoundStory story={round.story} canEdit={isHost} onSubmit={onSetStory} />
          </>
        ) : null}
      </header>

      <InviteLink code={room.code} />

      {mySeatId ? null : (
        <p
          data-testid="room-not-joined"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          Bạn đang xem phòng này mà chưa tham gia.{' '}
          <Link href={joinPath(room.code)} className="font-semibold underline">
            Vào phòng
          </Link>
        </p>
      )}

      {actionError ? (
        <p role="alert" data-testid="action-error" className="text-sm text-rose-400">
          {actionError}
        </p>
      ) : null}

      <RoomTable
        participants={participants}
        currentParticipantId={mySeatId}
        connection={mySeatId ? connection : 'none'}
        votedParticipantIds={votedIds}
        revealedVotes={revealed?.votes ?? null}
        myVote={myVote}
        isRevealed={isRevealed}
        reactions={reactions as LiveReaction[]}
        onEditVote={mySeatId && myVote !== null ? onStartEditingVote : undefined}
      />

      {mySeatId ? (
        <VoteDeck
          deckType={room.deckType}
          selected={myVote}
          // Locked once the cards are up — unless this browser asked to correct its own card,
          // which is issue #11's edit. The deck is the picker either way, so there is no second
          // card grid to keep in step with the first.
          disabled={isRevealed && !editingVote}
          editing={editingVote}
          onSelect={onSelectCard}
        />
      ) : null}

      {/* Reactions work in every round state, so this is outside the deck's revealed/editing
          branching entirely — the one thing in the room that is never locked. */}
      {mySeatId ? (
        <ReactionBar
          participants={participants}
          currentParticipantId={mySeatId}
          targetParticipantId={reactionTarget}
          onChangeTarget={setReactionTarget}
          onThrow={onThrowReaction}
          disabled={connection !== 'live'}
        />
      ) : null}
      {mySeatId && reactionError ? (
        <p role="alert" data-testid="reaction-error" className="text-xs text-rose-400">
          {reactionError}
        </p>
      ) : null}

      {/* FR-5/FR-7: host-only. The server refuses anybody else regardless, so hiding the
          buttons is an affordance rather than the security boundary. */}
      {isHost ? (
        <div className="flex flex-wrap gap-3" data-testid="host-controls">
          {isRevealed ? (
            <>
              <button
                type="button"
                data-testid="revote-button"
                onClick={onReset}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-indigo-500"
              >
                Vote lại
              </button>
              <button
                type="button"
                data-testid="new-round-button"
                onClick={onReset}
                className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                Task tiếp theo / Round mới
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="reveal-button"
              onClick={onReveal}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
            >
              Lật bài
            </button>
          )}
        </div>
      ) : null}

      {revealed ? (
        <RoundResults
          participants={participants}
          votesByParticipant={revealed.votes}
          tally={revealed.tally}
          deckType={room.deckType}
        />
      ) : null}

      {/* Collapsed by default, so the room still fits one screen. The key is what the panel
          watches: any of these changing means the history it is showing is now stale. */}
      <RoomHistoryPanel
        code={room.code}
        participantId={mySeatId}
        refreshKey={`${round?.id ?? ''}:${round?.status ?? ''}:${round?.story ?? ''}:${votesVersion}`}
      />
    </main>
  );
}
