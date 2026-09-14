import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Applies the real migrations before the web integration suite runs, by calling the API
 * workspace's migrate script — task 2 owns the schema and there is no second copy of it here.
 */
export async function setup(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

  await run('npm', ['run', 'migrate', '--workspace', '@planning-poker/api'], {
    cwd: repoRoot,
    env: process.env,
  });
}
