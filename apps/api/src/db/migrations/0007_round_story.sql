-- The item a round estimated (PRD §4 step 5, "task đang thảo luận").
--
-- Rounds already exist one per estimated item — PRD §7's "mỗi lần 'Round mới' tạo 1 record" —
-- so the room's history has always known *that* three things were estimated and never *which*.
-- This column is the label, and it is the one piece of a round's history that no timestamp,
-- vote or tally could reconstruct after the meeting.
--
-- Deliberately not a backlog table: PRD §11 keeps "quản lý nhiều task trong 1 phòng" out of the
-- MVP, and one nullable text column per round is the whole feature. Nullable because every
-- existing round has no story and because naming the item stays optional — a team that says it
-- out loud on the call still gets a usable export.
--
-- Retention needs no work: the row lives in voting_rounds, which 0002 already cascades from
-- rooms, so a story expires with its room on the FR-10 sweep like every other round fact.

ALTER TABLE voting_rounds
  ADD COLUMN IF NOT EXISTS story TEXT
    CHECK (story IS NULL OR char_length(btrim(story)) BETWEEN 1 AND 120);
