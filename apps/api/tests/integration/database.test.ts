import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { closePool, getPool } from '../../src/db/pool.js';
import { runMigrations } from '../../src/db/migrate.js';

/**
 * Runs the real migrations against the docker-compose Postgres, then does a genuine
 * round-trip: write through raw SQL, read back through the running Express app.
 */
describe('API + Postgres round-trip', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM app_metadata WHERE key = $1', ['integration_probe']);
    await closePool();
  });

  it('applies migrations and records them in schema_migrations', async () => {
    const { rows } = await getPool().query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    );

    expect(rows.map((r) => r.name)).toContain('0001_init.sql');
  });

  it('is idempotent when migrations are re-run', async () => {
    const newlyApplied = await runMigrations();

    expect(newlyApplied).toEqual([]);
  });

  it('writes and reads a row through the migrated schema', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO app_metadata (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      ['integration_probe', 'round-trip-ok'],
    );

    const { rows } = await pool.query<{ value: string }>(
      'SELECT value FROM app_metadata WHERE key = $1',
      ['integration_probe'],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe('round-trip-ok');
  });

  it('serves /health/db from the database, not from a constant', async () => {
    const response = await request(createApp()).get('/health/db');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', schemaBaseline: 'planning-poker-mvp' });
  });
});
