import type { Queryable } from '@/server/db/pool';

/**
 * Tables the auth suite writes to, children first. Room tables are listed as well because
 * `room_participants.user_id` references `users`; truncating with CASCADE would empty them
 * anyway, and naming them makes that explicit rather than surprising.
 */
export const AUTH_TABLES = [
  'accounts',
  'sessions',
  'verification_token',
  'user_credentials',
  'users',
] as const;

/** The web and API integration suites share one database, so each file starts from empty. */
export async function truncateAuthTables(db: Queryable): Promise<void> {
  await db.query(`TRUNCATE TABLE ${AUTH_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
