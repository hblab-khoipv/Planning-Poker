import {
  isValidGuestName,
  MAX_GUEST_NAME_LENGTH,
  normalizeGuestName,
  PARTICIPANT_ID_STORAGE_KEY,
} from '@planning-poker/shared';

/**
 * Guest identity (PRD §3.1.2, §6 "Guest session", FR-2).
 *
 * A visitor who never signs in still needs to be the same person across a reload: they get a
 * random `participant_id` kept in the browser plus the display name they typed when joining.
 * None of this touches NextAuth or the `users` table — a guest has no account, and
 * `room_participants.user_id` stays NULL for them (task 2 schema). The name recorded here is
 * what `POST /rooms/:code/join` seats them under; the seat's own id is kept per room by
 * `@/lib/room-membership`, because one browser can hold a seat in several rooms at once.
 */

export const GUEST_NAME_STORAGE_KEY = 'planning-poker:guest-name';

/**
 * Cookie mirror of the id, so a future server component / API route can read the guest identity
 * from the request. Cookie names may not contain ':', hence the different spelling.
 */
export const PARTICIPANT_ID_COOKIE = 'pp_participant_id';

/** A guest identity survives a closed tab but not a forgotten laptop. */
export const PARTICIPANT_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Name rules live in `@planning-poker/shared` so the API enforces the exact same ones; they are
 * re-exported here because this module is where the rest of the web app looks for them.
 */
export { isValidGuestName, MAX_GUEST_NAME_LENGTH, normalizeGuestName };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The slice of `Storage` this module needs. Narrow on purpose: the unit tests drive it with a
 * plain object, and nothing here has to pretend to be a full DOM.
 */
export interface IdentityStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isValidParticipantId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Overridable so tests get deterministic ids without stubbing globals. */
export function createParticipantId(): string {
  return crypto.randomUUID();
}

/**
 * Returns the stored id, minting and storing one when it is missing or corrupt (hand-edited
 * localStorage, a value written by an older version). Same visitor, same id, every call.
 */
export function getOrCreateParticipantId(
  store: IdentityStore,
  generate: () => string = createParticipantId,
): string {
  const stored = store.getItem(PARTICIPANT_ID_STORAGE_KEY);
  if (isValidParticipantId(stored)) return stored;

  const created = generate();
  store.setItem(PARTICIPANT_ID_STORAGE_KEY, created);
  return created;
}

export interface GuestIdentity {
  participantId: string;
  displayName: string;
}

/**
 * Records the name typed on the join screen against this browser's participant id.
 * Throws on a blank name rather than silently storing one the database would reject.
 */
export function saveGuestIdentity(
  store: IdentityStore,
  rawName: string,
  generate: () => string = createParticipantId,
): GuestIdentity {
  const displayName = normalizeGuestName(rawName);
  if (displayName.length === 0) throw new Error('guest display name must not be blank');

  const participantId = getOrCreateParticipantId(store, generate);
  store.setItem(GUEST_NAME_STORAGE_KEY, displayName);

  return { participantId, displayName };
}

/** Null when this browser has never joined as a guest (or the stored data is unusable). */
export function readGuestIdentity(store: IdentityStore): GuestIdentity | null {
  const participantId = store.getItem(PARTICIPANT_ID_STORAGE_KEY);
  const displayName = store.getItem(GUEST_NAME_STORAGE_KEY);

  if (!isValidParticipantId(participantId)) return null;
  if (!displayName || normalizeGuestName(displayName).length === 0) return null;

  return { participantId, displayName: normalizeGuestName(displayName) };
}

export function clearGuestIdentity(store: IdentityStore): void {
  store.removeItem(PARTICIPANT_ID_STORAGE_KEY);
  store.removeItem(GUEST_NAME_STORAGE_KEY);
}

/** Serializes the cookie mirror. Split out from `document.cookie` so it can be asserted on. */
export function participantIdCookie(participantId: string): string {
  return [
    `${PARTICIPANT_ID_COOKIE}=${participantId}`,
    'path=/',
    `max-age=${PARTICIPANT_ID_MAX_AGE_SECONDS}`,
    'samesite=lax',
  ].join('; ');
}

/**
 * localStorage plus a cookie mirror of the participant id. Returns null when there is no
 * browser (server render), which is why every caller is a client component effect/handler.
 */
export function browserIdentityStore(): IdentityStore | null {
  if (typeof window === 'undefined') return null;

  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
      if (key === PARTICIPANT_ID_STORAGE_KEY) document.cookie = participantIdCookie(value);
    },
    removeItem: (key) => {
      window.localStorage.removeItem(key);
      if (key === PARTICIPANT_ID_STORAGE_KEY) {
        document.cookie = `${PARTICIPANT_ID_COOKIE}=; path=/; max-age=0; samesite=lax`;
      }
    },
  };
}
