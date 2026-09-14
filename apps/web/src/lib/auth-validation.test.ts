import { describe, expect, it } from 'vitest';
import {
  checkPassword,
  isValidEmail,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  validateRegistration,
} from './auth-validation';

describe('normalizeEmail', () => {
  it('trims and lower-cases so one address is one account', () => {
    expect(normalizeEmail('  Khoi.PV@HBLab.VN \n')).toBe('khoi.pv@hblab.vn');
  });
});

describe('isValidEmail', () => {
  it.each(['a@b.co', 'khoi.pv+poker@hblab.vn', 'first_last@sub.domain.example'])(
    'accepts %s',
    (email) => {
      expect(isValidEmail(email)).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['no @', 'khoipv.hblab.vn'],
    ['no domain dot', 'khoi@localhost'],
    ['two @', 'a@b@c.vn'],
    ['space inside', 'khoi pv@hblab.vn'],
    ['nothing before @', '@hblab.vn'],
    ['trailing dot', 'khoi@hblab.'],
  ])('rejects %s', (_label, email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('rejects an address longer than the 254-character limit', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@hblab.vn`)).toBe(false);
  });
});

describe('checkPassword', () => {
  it('accepts a password at the floor', () => {
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 4) + 'bcd9')).toEqual([]);
  });

  it('rejects one character short of the floor', () => {
    expect(checkPassword('Abcd3'.slice(0, 5) + 'x'.repeat(MIN_PASSWORD_LENGTH - 6))).toContain(
      'too-short',
    );
  });

  it('rejects a password bcrypt would silently truncate', () => {
    // bcrypt stops at 72 bytes; accepting a longer one would make the ignored tail a lie.
    expect(checkPassword('x'.repeat(MAX_PASSWORD_BYTES + 1))).toContain('too-long');
  });

  it('counts bytes, not characters, for the bcrypt limit', () => {
    // 'đ' is two bytes, '☕' three: 24 x 3 = 72 bytes is allowed, 25 x 3 = 75 is not.
    expect(checkPassword('đ'.repeat(30))).not.toContain('too-long');
    expect(checkPassword('☕'.repeat(24))).not.toContain('too-long');
    expect(checkPassword('☕'.repeat(25))).toContain('too-long');
  });

  it('rejects a long password built from too few distinct characters', () => {
    expect(checkPassword('ababababababab')).toContain('too-simple');
  });

  it('reports every problem at once rather than the first', () => {
    expect(checkPassword('aaa').sort()).toEqual(['too-short', 'too-simple']);
  });
});

describe('validateRegistration', () => {
  const valid = { email: 'Khoi@HBLab.vn', password: 'poker-night-42', displayName: '  Khôi  ' };

  it('returns normalized values on success', () => {
    const result = validateRegistration(valid);

    expect(result).toEqual({
      ok: true,
      value: { email: 'khoi@hblab.vn', password: 'poker-night-42', displayName: 'Khôi' },
    });
  });

  it('treats a blank display name as absent rather than as an error', () => {
    const result = validateRegistration({ ...valid, displayName: '   ' });

    expect(result.ok && result.value.displayName).toBeNull();
  });

  it('rejects a display name over the limit', () => {
    const result = validateRegistration({
      ...valid,
      displayName: 'k'.repeat(MAX_DISPLAY_NAME_LENGTH + 1),
    });

    expect(result.ok).toBe(false);
  });

  it('collects email and password errors together', () => {
    const result = validateRegistration({ email: 'nope', password: 'aaa' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toHaveLength(3);
  });

  it('never returns the password in a failure result', () => {
    const result = validateRegistration({ email: 'nope', password: 'super-secret-value' });

    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });
});
