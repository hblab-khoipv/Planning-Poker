import { describe, expect, it } from 'vitest';
import {
  DECKS,
  isDeckType,
  isValidGuestName,
  MAX_GUEST_NAME_LENGTH,
  normalizeGuestName,
  SOCKET_EVENTS,
} from '@planning-poker/shared';

describe('@planning-poker/shared is consumable from the API', () => {
  it('exposes the PRD decks', () => {
    expect(DECKS.fibonacci).toEqual(['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕']);
    expect(DECKS.tshirt).toContain('XL');
  });

  it('validates deck types', () => {
    expect(isDeckType('fibonacci')).toBe(true);
    expect(isDeckType('planning-poker')).toBe(false);
  });

  it('exposes the realtime event names', () => {
    expect(SOCKET_EVENTS.ROUND_REVEALED).toBe('round:revealed');
  });
});

/**
 * Display-name rules are shared so the browser and the API cannot disagree about what is
 * acceptable; the API is the one that has to hold, because the browser's copy is advisory.
 */
describe('guest display names', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(normalizeGuestName('  Phạm   Văn  Khôi  ')).toBe('Phạm Văn Khôi');
  });

  it('clips to the documented maximum rather than returning something the column rejects', () => {
    expect(normalizeGuestName('x'.repeat(MAX_GUEST_NAME_LENGTH + 10))).toHaveLength(
      MAX_GUEST_NAME_LENGTH,
    );
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['only a tab', '\t'],
    ['only a newline', '\n'],
  ])('rejects a %s name, which the guest_name CHECK would too', (_label, value) => {
    expect(isValidGuestName(value)).toBe(false);
  });

  it('accepts a name that is blank-padded but not blank', () => {
    expect(isValidGuestName('  Khôi ')).toBe(true);
  });
});
