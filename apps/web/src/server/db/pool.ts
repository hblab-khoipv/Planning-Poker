import pg from 'pg';

/**
 * The web app's connection to the same Postgres the API uses (task 2's schema and migrations
 * stay the single source of truth — nothing here creates or alters tables).
 *
 * NextAuth runs inside the Next.js server runtime, so the adapter needs a pool on this side of
 * the monorepo; `apps/api`'s pool lives in a different process and cannot be shared.
 * Same lazy-singleton shape as `apps/api/src/db/pool.ts` so the two behave alike.
 */

let pool: pg.Pool | undefined;

export function databaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    'postgresql://planning_poker:planning_poker@localhost:5432/planning_poker'
  );
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl() });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}

/**
 * Anything a query can run on: the pool, or one checked-out client. Mirrors the API's
 * repository convention — query functions take this first and never open transactions
 * themselves, so callers decide the transaction boundary.
 */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/** Runs `fn` on a dedicated client inside BEGIN/COMMIT, rolling back on any throw. */
export async function withTransaction<T>(
  poolInstance: pg.Pool,
  fn: (client: Queryable) => Promise<T>,
): Promise<T> {
  const client = await poolInstance.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
