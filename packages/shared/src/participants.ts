/**
 * Display-name rules for a seat in a room (PRD §3.1.2, FR-2).
 *
 * These live in the shared package because both sides enforce them: the browser so a guest sees
 * the problem before a round trip, and the API because the browser's opinion is not authoritative.
 * `room_participants.guest_name` has a `char_length(btrim(...)) > 0` CHECK, so a blank name would
 * otherwise fail as a 500 from Postgres rather than a 400 from us.
 */

export const MAX_GUEST_NAME_LENGTH = 40;

/** Collapses whitespace and clips to the column's practical limit. */
export function normalizeGuestName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_GUEST_NAME_LENGTH);
}

export function isValidGuestName(raw: string): boolean {
  return normalizeGuestName(raw).length > 0;
}
