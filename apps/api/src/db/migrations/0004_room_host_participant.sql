-- Gives every room a host, including the guest-created ones (PRD §12's open question
-- "Ai được quyền bấm 'Lộ bài'", resolved for the MVP as: only the host).
--
-- `rooms.host_id` cannot answer that question on its own. It references `users`, so it is NULL
-- whenever a guest created the room (PRD §7: "nullable nếu host là guest") -- and a guest-created
-- room is the primary MVP flow. Without this column such a room has no host at all, and FR-5's
-- "Lộ bài" would be a button nobody in the room is ever allowed to press.
--
-- host_participant_id points at the creator's seat instead, which exists for guests and members
-- alike. Authority is the OR of the two (see apps/api/src/http/authority.ts): the seat is the
-- host's seat, or the caller's account is the room's host account. Keeping host_id as well
-- means a signed-in host who somehow lands on a different seat -- a seat deleted and retaken --
-- does not lose their own room.
--
-- ON DELETE SET NULL rather than CASCADE: a host who leaves must not take the room with them.

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS host_participant_id uuid
  REFERENCES room_participants (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rooms_host_participant_id_idx ON rooms (host_participant_id);

-- Rooms created before this migration have no recorded host seat. The earliest participant is
-- the creator (POST /rooms seats them inside the same transaction that creates the room), so
-- adopting it here leaves no existing room stranded without a host.
UPDATE rooms r
   SET host_participant_id = earliest.id
  FROM (
    SELECT DISTINCT ON (room_id) room_id, id
      FROM room_participants
     ORDER BY room_id, joined_at, id
  ) AS earliest
 WHERE earliest.room_id = r.id
   AND r.host_participant_id IS NULL;
