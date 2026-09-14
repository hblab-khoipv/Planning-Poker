import type pg from 'pg';
import type { Queryable } from './repositories/index.js';

/**
 * Runs `fn` inside one transaction on a single checked-out client.
 *
 * The repositories deliberately never BEGIN or COMMIT (see `repositories/types.ts`), which is
 * what lets a route compose several writes — creating a room and seating its host is one
 * indivisible step, or the host ends up outside their own room.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (db: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
