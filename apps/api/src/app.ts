import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config.js';
import { getPool } from './db/pool.js';

export interface HealthResponse {
  status: 'ok';
  service: 'planning-poker-api';
  uptime: number;
}

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
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
      const { rows } = await getPool().query<{ value: string }>(
        'SELECT value FROM app_metadata WHERE key = $1',
        ['schema_baseline'],
      );
      res.status(200).json({ status: 'ok', schemaBaseline: rows[0]?.value ?? null });
    } catch (error) {
      res.status(503).json({ status: 'error', message: (error as Error).message });
    }
  });

  return app;
}
