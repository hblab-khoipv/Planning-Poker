import { type Queryable, type User, ValidationError } from './types.js';

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  created_at: Date;
}

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.name,
    email: row.email,
    image: row.image,
    createdAt: row.created_at,
  };
}

const USER_COLUMNS = 'id, name, email, image, created_at';

export interface CreateUserInput {
  email?: string | null;
  displayName?: string | null;
  image?: string | null;
}

/**
 * Creates a user directly. In normal operation NextAuth's adapter owns this table (task 3);
 * this exists so tests and fixtures can mint a signed-in user without booting the auth stack.
 */
export async function createUser(db: Queryable, input: CreateUserInput = {}): Promise<User> {
  const email = input.email?.trim() ?? null;
  if (email !== null && !email.includes('@')) {
    throw new ValidationError('email must be an email address');
  }

  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (name, email, image) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
    [input.displayName?.trim() || null, email, input.image ?? null],
  );

  return mapUser(expectOne(rows, 'user insert returned no row'));
}

export async function findUserById(db: Queryable, id: string): Promise<User | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? mapUser(row) : null;
}

/** Narrows `rows[0]` for `noUncheckedIndexedAccess` on statements that always return a row. */
export function expectOne<T>(rows: T[], message: string): T {
  const row = rows[0];
  if (!row) throw new Error(message);
  return row;
}
