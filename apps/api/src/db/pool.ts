import pg from 'pg';
import { config } from '../config.js';

let pool: pg.Pool | undefined;

/** Lazily created singleton pool so importing the app never opens a connection. */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.databaseUrl });
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
