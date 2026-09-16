-- Session history (PRD FR-9) asks one question this schema had no index for: "which rooms does
-- this account have a seat in?".
--
-- `room_participants` already has an index per room (room_participants_room_id_idx) and a partial
-- unique index on (room_id, user_id), but neither can answer a lookup that starts from the user:
-- the unique index is keyed on room_id first, so a user-only predicate cannot seek into it. Both
-- history endpoints filter exactly that way -- listRoomHistoryForUser's EXISTS subquery and
-- isRoomMember's membership check -- so without this they degrade into a scan of every seat ever
-- taken, which grows with total traffic rather than with the user's own history.
--
-- Partial, because guest seats have a NULL user_id and are never the subject of this lookup:
-- history belongs to accounts only. That keeps the index proportional to signed-in usage.

CREATE INDEX IF NOT EXISTS room_participants_user_id_idx
  ON room_participants (user_id)
  WHERE user_id IS NOT NULL;
