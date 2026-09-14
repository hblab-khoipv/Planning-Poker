import { PARTICIPANT_ID_STORAGE_KEY } from '@planning-poker/shared';
import { describe, expect, it } from 'vitest';
import {
  clearGuestIdentity,
  createParticipantId,
  getOrCreateParticipantId,
  GUEST_NAME_STORAGE_KEY,
  type IdentityStore,
  isValidGuestName,
  isValidParticipantId,
  MAX_GUEST_NAME_LENGTH,
  normalizeGuestName,
  PARTICIPANT_ID_COOKIE,
  participantIdCookie,
  readGuestIdentity,
  saveGuestIdentity,
} from './guest-identity';

/** A stand-in for localStorage that also records what was written, in order. */
function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: Array<[string, string]> = [];

  const store: IdentityStore = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
      writes.push([key, value]);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };

  return { store, data, writes };
}

const ID_A = '11111111-2222-4333-8444-555555555555';

describe('createParticipantId', () => {
  it('mints a distinct uuid each time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createParticipantId()));

    expect(ids.size).toBe(50);
    for (const id of ids) expect(isValidParticipantId(id)).toBe(true);
  });
});

describe('getOrCreateParticipantId', () => {
  it('stores a new id the first time', () => {
    const { store, data } = fakeStore();

    const id = getOrCreateParticipantId(store, () => ID_A);

    expect(id).toBe(ID_A);
    expect(data.get(PARTICIPANT_ID_STORAGE_KEY)).toBe(ID_A);
  });

  it('returns the same id on every later call without writing again', () => {
    const { store, writes } = fakeStore({ [PARTICIPANT_ID_STORAGE_KEY]: ID_A });

    expect(getOrCreateParticipantId(store)).toBe(ID_A);
    expect(getOrCreateParticipantId(store)).toBe(ID_A);
    expect(writes).toEqual([]);
  });

  it('replaces a stored value that is not a uuid', () => {
    const { store, data } = fakeStore({ [PARTICIPANT_ID_STORAGE_KEY]: 'hand-edited' });

    expect(getOrCreateParticipantId(store, () => ID_A)).toBe(ID_A);
    expect(data.get(PARTICIPANT_ID_STORAGE_KEY)).toBe(ID_A);
  });

  it('uses the shared storage key so the API and the client agree on it', () => {
    expect(PARTICIPANT_ID_STORAGE_KEY).toBe('planning-poker:participant-id');
  });
});

describe('normalizeGuestName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeGuestName('  Khôi   Phạm \n')).toBe('Khôi Phạm');
  });

  it('clips to the maximum length', () => {
    expect(normalizeGuestName('k'.repeat(100))).toHaveLength(MAX_GUEST_NAME_LENGTH);
  });

  it.each(['', '   ', '\t\n'])('treats %j as not a name', (raw) => {
    expect(isValidGuestName(raw)).toBe(false);
  });
});

describe('saveGuestIdentity / readGuestIdentity', () => {
  it('persists the normalized name against a freshly minted id', () => {
    const { store, data } = fakeStore();

    const identity = saveGuestIdentity(store, '  Khôi  ', () => ID_A);

    expect(identity).toEqual({ participantId: ID_A, displayName: 'Khôi' });
    expect(data.get(GUEST_NAME_STORAGE_KEY)).toBe('Khôi');
  });

  it('keeps the existing id when the guest renames themselves', () => {
    const { store } = fakeStore({ [PARTICIPANT_ID_STORAGE_KEY]: ID_A });

    saveGuestIdentity(store, 'Tên cũ');
    const renamed = saveGuestIdentity(store, 'Tên mới');

    expect(renamed.participantId).toBe(ID_A);
    expect(renamed.displayName).toBe('Tên mới');
  });

  it('refuses a blank name instead of storing one the database would reject', () => {
    const { store } = fakeStore();

    expect(() => saveGuestIdentity(store, '   ')).toThrow(/blank/);
  });

  it('round-trips through the store', () => {
    const { store } = fakeStore();
    const saved = saveGuestIdentity(store, 'Khôi', () => ID_A);

    expect(readGuestIdentity(store)).toEqual(saved);
  });

  it.each([
    ['nothing stored', {}],
    ['id but no name', { [PARTICIPANT_ID_STORAGE_KEY]: ID_A }],
    ['name but no id', { [GUEST_NAME_STORAGE_KEY]: 'Khôi' }],
    ['corrupt id', { [PARTICIPANT_ID_STORAGE_KEY]: 'nope', [GUEST_NAME_STORAGE_KEY]: 'Khôi' }],
    ['blank name', { [PARTICIPANT_ID_STORAGE_KEY]: ID_A, [GUEST_NAME_STORAGE_KEY]: '   ' }],
  ])('reads null when %s', (_label, initial) => {
    expect(readGuestIdentity(fakeStore(initial).store)).toBeNull();
  });

  it('clears both keys', () => {
    const { store, data } = fakeStore();
    saveGuestIdentity(store, 'Khôi', () => ID_A);

    clearGuestIdentity(store);

    expect(data.size).toBe(0);
    expect(readGuestIdentity(store)).toBeNull();
  });
});

describe('participantIdCookie', () => {
  it('is scoped to the whole site, lax, and long-lived', () => {
    const cookie = participantIdCookie(ID_A);

    expect(cookie).toContain(`${PARTICIPANT_ID_COOKIE}=${ID_A}`);
    expect(cookie).toContain('path=/');
    expect(cookie).toContain('samesite=lax');
    expect(cookie).toMatch(/max-age=\d+/);
  });

  it('uses a cookie-safe name (no colon, unlike the storage key)', () => {
    expect(PARTICIPANT_ID_COOKIE).not.toContain(':');
  });
});
