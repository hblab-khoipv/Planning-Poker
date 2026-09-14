/**
 * Validation rules for the credentials sign-up form (PRD FR-8).
 *
 * Pure functions with no Node or browser dependency, so the register page validates with the
 * exact same code the API route enforces — the client cannot be nicer to itself than the server.
 */

/** bcrypt hashes at most the first 72 *bytes* of a password and silently ignores the rest. */
export const MAX_PASSWORD_BYTES = 72;

/** Floor, not a policy statement: long enough that an online guess costs more than it is worth. */
export const MIN_PASSWORD_LENGTH = 10;

export const MAX_EMAIL_LENGTH = 254;
export const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * Deliberately permissive: one `@`, something either side, a dot in the domain, no spaces.
 * Anything stricter rejects addresses that are legal and deliverable, and the only real proof
 * an address exists is sending mail to it.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Addresses are compared and stored lower-cased so `A@x.io` and `a@x.io` are one account. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

export type PasswordProblem = 'too-short' | 'too-long' | 'too-simple';

/**
 * Returns every reason the password is unacceptable, empty array when it is fine.
 * `too-simple` catches a single repeated character ("aaaaaaaaaa") passing the length floor.
 */
export function checkPassword(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) problems.push('too-short');
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) problems.push('too-long');
  if (new Set(password).size < 4) problems.push('too-simple');

  return problems;
}

export interface RegistrationInput {
  email: string;
  password: string;
  displayName?: string | null;
}

export interface NormalizedRegistration {
  email: string;
  password: string;
  displayName: string | null;
}

export type RegistrationValidation =
  { ok: true; value: NormalizedRegistration } | { ok: false; errors: string[] };

const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  'too-short': `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`,
  'too-long': `Mật khẩu không được vượt quá ${MAX_PASSWORD_BYTES} byte.`,
  'too-simple': 'Mật khẩu phải có ít nhất 4 ký tự khác nhau.',
};

/** Validates and normalizes in one pass so callers never re-derive the trimmed/lowered values. */
export function validateRegistration(input: RegistrationInput): RegistrationValidation {
  const errors: string[] = [];

  const email = normalizeEmail(input.email ?? '');
  if (!isValidEmail(email)) errors.push('Email không hợp lệ.');

  const password = input.password ?? '';
  for (const problem of checkPassword(password)) errors.push(PASSWORD_MESSAGES[problem]);

  const displayName = (input.displayName ?? '').trim();
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    errors.push(`Tên hiển thị không được vượt quá ${MAX_DISPLAY_NAME_LENGTH} ký tự.`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, value: { email, password, displayName: displayName || null } };
}
