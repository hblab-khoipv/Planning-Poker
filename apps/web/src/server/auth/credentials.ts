import type pg from 'pg';
import {
  normalizeEmail,
  validateRegistration,
  type RegistrationInput,
} from '@/lib/auth-validation';
import { getPool, withTransaction, type Queryable } from '@/server/db/pool';
import { hashPassword, verifyPassword } from '@/server/auth/password';

/**
 * Email + password accounts (PRD FR-8), stored in task 2's `users` table plus the
 * `user_credentials` side table from migration 0003.
 *
 * Every function takes a `Queryable` first, matching the API's repository convention: the
 * caller owns the transaction boundary, these never BEGIN or COMMIT.
 */

/** The provider name written into `accounts` for a password login. */
export const CREDENTIALS_PROVIDER = 'credentials';

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  image: string | null;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

function mapUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, displayName: row.name, image: row.image };
}

/** Raised when the email is already taken — the one registration failure that is the user's. */
export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('email is already registered');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export async function findUserByEmail(db: Queryable, email: string): Promise<AuthUser | null> {
  const { rows } = await db.query<UserRow>(
    'SELECT id, name, email, image FROM users WHERE email = $1',
    [normalizeEmail(email)],
  );
  const row = rows[0];
  return row ? mapUser(row) : null;
}

export interface UserWithPassword extends AuthUser {
  /** NULL for a user who only ever signed in with Google — they have no `user_credentials` row. */
  passwordHash: string | null;
}

/** One query, so a login does not pay two round-trips to find out the password is wrong. */
export async function findUserWithPasswordByEmail(
  db: Queryable,
  email: string,
): Promise<UserWithPassword | null> {
  const { rows } = await db.query<UserRow & { password_hash: string | null }>(
    `SELECT u.id, u.name, u.email, u.image, c.password_hash
       FROM users u
       LEFT JOIN user_credentials c ON c.user_id = u.id
      WHERE u.email = $1`,
    [normalizeEmail(email)],
  );

  const row = rows[0];
  return row ? { ...mapUser(row), passwordHash: row.password_hash } : null;
}

export interface CreateCredentialsUserInput {
  email: string;
  passwordHash: string;
  displayName?: string | null;
}

/**
 * Creates the user, its password row and an `accounts` row for the credentials provider.
 *
 * The `accounts` row is not something NextAuth requires — the Credentials provider never calls
 * the adapter — but writing it keeps `accounts` the one honest answer to "how can this user sign
 * in", which is what makes a later Google sign-in on the same address visibly a *second* row
 * against the same user rather than a mystery. Call inside a transaction: three writes, one fact.
 */
export async function createCredentialsUser(
  db: Queryable,
  input: CreateCredentialsUserInput,
): Promise<AuthUser> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName?.trim() || null;

  let userRows;
  try {
    ({ rows: userRows } = await db.query<UserRow>(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email, image',
      [displayName, email],
    ));
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailAlreadyRegisteredError();
    throw error;
  }

  const user = userRows[0];
  if (!user) throw new Error('user insert returned no row');

  await db.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
    user.id,
    input.passwordHash,
  ]);

  await db.query(
    `INSERT INTO accounts ("userId", type, provider, "providerAccountId")
     VALUES ($1, $2, $3, $4)`,
    [user.id, CREDENTIALS_PROVIDER, CREDENTIALS_PROVIDER, user.id],
  );

  return mapUser(user);
}

export type RegistrationResult =
  { ok: true; user: AuthUser } | { ok: false; errors: string[]; status: 400 | 409 };

/**
 * The whole sign-up: validate, hash, write. Returns failures instead of throwing them so the
 * API route can answer the form without a try/catch ladder.
 */
export async function registerUser(
  input: RegistrationInput,
  pool: pg.Pool = getPool(),
): Promise<RegistrationResult> {
  const validation = validateRegistration(input);
  if (!validation.ok) return { ok: false, errors: validation.errors, status: 400 };

  const { email, password, displayName } = validation.value;
  const passwordHash = await hashPassword(password);

  try {
    const user = await withTransaction(pool, (client) =>
      createCredentialsUser(client, { email, passwordHash, displayName }),
    );
    return { ok: true, user };
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return { ok: false, errors: ['Email này đã được đăng ký.'], status: 409 };
    }
    throw error;
  }
}

/**
 * The Credentials provider's `authorize`: returns the user on a correct password, `null` on
 * anything else. Never distinguishes "no such account" from "wrong password" to the caller, and
 * `verifyPassword` makes the two cost the same time (see its DUMMY_HASH note).
 */
export async function authenticateWithPassword(
  db: Queryable,
  email: string,
  password: string,
): Promise<AuthUser | null> {
  if (!email || !password) return null;

  const found = await findUserWithPasswordByEmail(db, email);
  const matches = await verifyPassword(password, found?.passwordHash ?? null);
  if (!found || !matches) return null;

  return { id: found.id, email: found.email, displayName: found.displayName, image: found.image };
}
