import { describe, expect, it } from 'vitest';
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
} from './room-code.js';

describe('generateRoomCode', () => {
  it('produces a code of the documented length', () => {
    expect(generateRoomCode()).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('only emits characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateRoomCode()).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it('never emits the look-alike characters I, L, O or U', () => {
    const sample = Array.from({ length: 500 }, () => generateRoomCode()).join('');

    expect(sample).not.toMatch(/[ILOU]/);
  });

  it('does not repeat itself over many draws', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateRoomCode()));

    // 32^8 keyspace: a collision in 1000 draws would mean the generator is not random.
    expect(codes.size).toBe(1000);
  });

  it('always generates codes that pass its own validator', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isValidRoomCode(generateRoomCode())).toBe(true);
    }
  });
});

describe('normalizeRoomCode', () => {
  it('trims surrounding whitespace and upper-cases', () => {
    expect(normalizeRoomCode('  ab12cd34  ')).toBe('AB12CD34');
  });

  it.each([
    ['I', '1'],
    ['L', '1'],
    ['O', '0'],
    ['U', 'V'],
  ])('maps the look-alike %s onto %s', (input, expected) => {
    expect(normalizeRoomCode(`${input}2345678`)).toBe(`${expected}2345678`);
  });

  it('rescues a code typed with every confusable character at once', () => {
    expect(normalizeRoomCode('ilou2345')).toBe('110V2345');
  });

  it('leaves an already-canonical code untouched', () => {
    const code = generateRoomCode();

    expect(normalizeRoomCode(code)).toBe(code);
  });
});

describe('isValidRoomCode', () => {
  it('accepts a canonical code', () => {
    expect(isValidRoomCode('AB12CD34')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', 'AB12CD3'],
    ['too long', 'AB12CD345'],
    ['lower case', 'ab12cd34'],
    ['excluded letter I', 'IB12CD34'],
    ['punctuation', 'AB12-CD3'],
    ['untrimmed', ' AB12CD34'],
  ])('rejects a %s code', (_label, code) => {
    expect(isValidRoomCode(code)).toBe(false);
  });
});
