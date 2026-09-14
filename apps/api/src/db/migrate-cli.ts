import { closePool } from './pool.js';
import { runMigrations } from './migrate.js';

const applied = await runMigrations();
console.info(
  applied.length > 0 ? `Applied migrations: ${applied.join(', ')}` : 'No pending migrations.',
);
await closePool();
