'use client';

import { MAX_STORY_LENGTH } from '@planning-poker/shared';
import { useEffect, useState } from 'react';

/**
 * The item the current round is estimating (PRD §4 step 5's "task đang thảo luận").
 *
 * The host gets an input, everybody else the text — the server refuses a non-host either way, so
 * hiding the input is an affordance rather than the boundary, exactly as with the reveal button.
 *
 * It commits on blur and on Enter rather than on every keystroke: a story is typed, not dragged,
 * and broadcasting each character would put a `round:updated` on the wire per letter. The local
 * draft resyncs whenever the server's value changes, so a story somebody else set still lands.
 */
export function RoundStory({
  story,
  canEdit,
  onSubmit,
}: {
  story: string | null;
  canEdit: boolean;
  onSubmit: (story: string) => void;
}) {
  const [draft, setDraft] = useState(story ?? '');

  useEffect(() => {
    setDraft(story ?? '');
  }, [story]);

  if (!canEdit) {
    return (
      <p data-testid="round-story" className="text-sm text-slate-300">
        {story ?? <span className="text-slate-500">Chưa đặt tên story cho round này</span>}
      </p>
    );
  }

  const commit = () => {
    if (draft.trim() === (story ?? '').trim()) return;
    onSubmit(draft);
  };

  return (
    <input
      type="text"
      data-testid="round-story-input"
      value={draft}
      maxLength={MAX_STORY_LENGTH}
      placeholder="Đang estimate story nào? (tuỳ chọn)"
      aria-label="Tên story của round này"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
    />
  );
}
