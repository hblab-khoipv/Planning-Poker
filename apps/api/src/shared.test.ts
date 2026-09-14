import { describe, expect, it } from 'vitest';
import { DECKS, SOCKET_EVENTS, isDeckType } from '@planning-poker/shared';

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
