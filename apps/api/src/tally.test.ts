import { describe, expect, it } from 'vitest';
import {
  averageOf,
  hasConsensus,
  isNumericCard,
  isNumericDeck,
  medianOf,
  numericCardValues,
  tallyVotes,
} from '@planning-poker/shared';

/**
 * FR-6's arithmetic. The implementation lives in `packages/shared` because both ends need the
 * same answer; its tests live here because the shared package is consumed as compiled output and
 * has no runner of its own — the same arrangement as `src/shared.test.ts`.
 */

describe('isNumericCard', () => {
  it('accepts the Fibonacci faces', () => {
    for (const card of ['0', '1', '2', '3', '5', '8', '13', '21']) {
      expect(isNumericCard(card)).toBe(true);
    }
  });

  it('rejects the abstention cards and every t-shirt size', () => {
    for (const card of ['?', '☕', 'XS', 'S', 'M', 'L', 'XL', '']) {
      expect(isNumericCard(card)).toBe(false);
    }
  });
});

describe('numericCardValues', () => {
  it('drops the abstentions rather than scoring them as zero', () => {
    expect(numericCardValues(['3', '?', '5', '☕'])).toEqual([3, 5]);
  });
});

describe('averageOf', () => {
  it('averages and rounds to two decimals', () => {
    expect(averageOf([1, 2, 3])).toBe(2);
    expect(averageOf([1, 2])).toBe(1.5);
    // 8/3 = 2.666… — the rounding is what keeps the wire value free of float noise.
    expect(averageOf([1, 2, 5])).toBe(2.67);
  });

  it('is null for no numbers at all', () => {
    expect(averageOf([])).toBeNull();
  });
});

describe('medianOf', () => {
  it('takes the middle value of an odd count', () => {
    expect(medianOf([5, 1, 3])).toBe(3);
  });

  it('takes the mean of the two middle values of an even count', () => {
    expect(medianOf([1, 2, 3, 8])).toBe(2.5);
  });

  it('sorts numerically, not lexicographically', () => {
    // The bug this pins: [1, 13, 2, 21, 3].sort() would put 13 before 2 and answer 2.
    expect(medianOf([1, 13, 2, 21, 3])).toBe(3);
  });

  it('is null for no numbers at all', () => {
    expect(medianOf([])).toBeNull();
  });
});

describe('hasConsensus', () => {
  it('is true when every voter chose the same card', () => {
    expect(hasConsensus(['5', '5', '5'])).toBe(true);
  });

  it('works for a non-numeric deck too', () => {
    expect(hasConsensus(['M', 'M'])).toBe(true);
    expect(hasConsensus(['M', 'L'])).toBe(false);
  });

  it('is false for a single vote — one person does not agree with anybody', () => {
    expect(hasConsensus(['5'])).toBe(false);
    expect(hasConsensus([])).toBe(false);
  });

  it('counts abstentions as values, so a room of "?" is agreement on nothing', () => {
    expect(hasConsensus(['?', '?'])).toBe(true);
    expect(hasConsensus(['?', '5'])).toBe(false);
  });
});

describe('isNumericDeck', () => {
  it('is the Fibonacci deck only (PRD FR-6 "deck số")', () => {
    expect(isNumericDeck('fibonacci')).toBe(true);
    expect(isNumericDeck('tshirt')).toBe(false);
  });
});

describe('tallyVotes', () => {
  it('summarises a numeric round', () => {
    expect(tallyVotes('fibonacci', ['1', '2', '3', '8'])).toEqual({
      voteCount: 4,
      numericCount: 4,
      average: 3.5,
      median: 2.5,
      consensus: false,
    });
  });

  it('counts abstentions as votes but keeps them out of the maths', () => {
    expect(tallyVotes('fibonacci', ['5', '5', '?', '☕'])).toEqual({
      voteCount: 4,
      numericCount: 2,
      average: 5,
      median: 5,
      consensus: false,
    });
  });

  it('flags consensus', () => {
    expect(tallyVotes('fibonacci', ['8', '8', '8'])).toMatchObject({
      average: 8,
      median: 8,
      consensus: true,
    });
  });

  it('gives a t-shirt round a consensus flag but no average or median', () => {
    expect(tallyVotes('tshirt', ['M', 'M', 'M'])).toEqual({
      voteCount: 3,
      numericCount: 0,
      average: null,
      median: null,
      consensus: true,
    });
  });

  it('is empty-but-defined for a round nobody voted in', () => {
    expect(tallyVotes('fibonacci', [])).toEqual({
      voteCount: 0,
      numericCount: 0,
      average: null,
      median: null,
      consensus: false,
    });
  });
});
