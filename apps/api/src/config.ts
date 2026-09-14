import 'dotenv/config';

function optionalNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: optionalNumber(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://planning_poker:planning_poker@localhost:5432/planning_poker',
} as const;
