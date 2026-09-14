import { describe, expect, it } from 'vitest';
import type { IdentityStore } from '@/lib/guest-identity';
import {
  clearRoomMembership,
  membershipStorageKey,
  readRoomMembership,
  saveRoomMembership,
} from '@/lib/room-membership';

const SEAT = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const OTHER_SEAT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function memoryStore(initial: Record<string, string> = {}): IdentityStore & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe('membershipStorageKey', () => {
  it('is namespaced per room, so one browser can hold several seats at once', () => {
    expect(membershipStorageKey('AB12CD34')).not.toBe(membershipStorageKey('ZZ99ZZ99'));
  });

  it('ignores the case the code was typed in', () => {
    expect(membershipStorageKey('ab12cd34')).toBe(membershipStorageKey('AB12CD34'));
  });
});

describe('readRoomMembership', () => {
  it('returns null for a room this browser has never joined', () => {
    expect(readRoomMembership(memoryStore(), 'AB12CD34')).toBeNull();
  });

  it('returns the seat saved for that room', () => {
    const store = memoryStore();
    saveRoomMembership(store, 'AB12CD34', SEAT);

    expect(readRoomMembership(store, 'AB12CD34')).toBe(SEAT);
  });

  it('does not hand one room’s seat to another room', () => {
    const store = memoryStore();
    saveRoomMembership(store, 'AB12CD34', SEAT);
    saveRoomMembership(store, 'ZZ99ZZ99', OTHER_SEAT);

    expect(readRoomMembership(store, 'AB12CD34')).toBe(SEAT);
    expect(readRoomMembership(store, 'ZZ99ZZ99')).toBe(OTHER_SEAT);
  });

  it('ignores a hand-edited value that is not a participant id', () => {
    const store = memoryStore({ [membershipStorageKey('AB12CD34')]: 'not-a-uuid' });

    expect(readRoomMembership(store, 'AB12CD34')).toBeNull();
  });
});

describe('saveRoomMembership', () => {
  it('refuses to store something the join endpoint would reject', () => {
    expect(() => saveRoomMembership(memoryStore(), 'AB12CD34', 'nope')).toThrow(/participant id/);
  });

  it('replaces the previous seat for the same room', () => {
    const store = memoryStore();
    saveRoomMembership(store, 'AB12CD34', SEAT);
    saveRoomMembership(store, 'AB12CD34', OTHER_SEAT);

    expect(readRoomMembership(store, 'AB12CD34')).toBe(OTHER_SEAT);
  });
});

describe('clearRoomMembership', () => {
  it('forgets one room without touching the others', () => {
    const store = memoryStore();
    saveRoomMembership(store, 'AB12CD34', SEAT);
    saveRoomMembership(store, 'ZZ99ZZ99', OTHER_SEAT);

    clearRoomMembership(store, 'AB12CD34');

    expect(readRoomMembership(store, 'AB12CD34')).toBeNull();
    expect(readRoomMembership(store, 'ZZ99ZZ99')).toBe(OTHER_SEAT);
  });
});
