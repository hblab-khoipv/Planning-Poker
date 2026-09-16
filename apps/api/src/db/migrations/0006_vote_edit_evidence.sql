-- Edit-after-reveal evidence (issue #11).
--
-- PRD FR-4 only allows changing a card *before* the reveal, where a change leaves no trace worth
-- keeping: nobody has seen the old card. Issue #11 adds the other case — changing a card the room
-- has already looked at — and that one is only acceptable if it is visible. These two columns are
-- that visibility, stored rather than derived, because "Lan showed 8, then made it 3" is a fact
-- about a past moment that no later snapshot of `votes.value` could reconstruct.
--
-- original_value holds the card as the room first saw it, not the immediately previous one: a
-- seat that edits twice still shows the room what it agreed to compare against.

ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS original_value TEXT
    CHECK (original_value IS NULL OR char_length(original_value) BETWEEN 1 AND 8);

ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- The two halves of the evidence cannot disagree: a vote is either untouched since the reveal, or
-- it carries both the card it replaced and the moment it was replaced. Mirrors the existing
-- voting_rounds.status/revealed_at constraint, for the same reason.
DO $$
BEGIN
  ALTER TABLE votes
    ADD CONSTRAINT votes_edit_evidence_complete
      CHECK ((original_value IS NULL) = (edited_at IS NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
