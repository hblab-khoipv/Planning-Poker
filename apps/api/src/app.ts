import cors from 'cors';
import express, { type Express } from 'express';
import type pg from 'pg';
import { config } from './config.js';
import { getPool } from './db/pool.js';
import { errorBody, errorHandler } from './http/errors.js';
import { createRoomsRouter } from './routes/rooms.js';
import { createUsersRouter } from './routes/users.js';

export interface HealthResponse {
  status: 'ok';
  service: 'planning-poker-api';
  uptime: number;
}

export interface CreateAppOptions {
  /** Lets the integration suite drive the app on its own pool instead of the process singleton. */
  pool?: pg.Pool;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const pool = options.pool ?? getPool();

  // `credentials` is what lets the browser send NextAuth's session cookie to this origin; the
  // API reads it to tell a signed-in caller from a guest (see http/session.ts).
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'planning-poker-api',
      uptime: process.uptime(),
    };
    res.status(200).json(body);
  });

  // Readiness: unlike /health this one actually touches Postgres.
  app.get('/health/db', async (_req, res) => {
    try {
      const { rows } = await pool.query<{ value: string }>(
        'SELECT value FROM app_metadata WHERE key = $1',
        ['schema_baseline'],
      );
      res.status(200).json({ status: 'ok', schemaBaseline: rows[0]?.value ?? null });
    } catch (error) {
      res.status(503).json({ status: 'error', message: (error as Error).message });
    }
  });

  app.use('/rooms', createRoomsRouter(pool));
  app.use('/users', createUsersRouter(pool));

  app.use((_req, res) => {
    res.status(404).json(errorBody('not_found', 'route not found'));
  });
  app.use(errorHandler());

  return app;
}
