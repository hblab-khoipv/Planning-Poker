# Visual evidence

Screenshots attached to the pull requests as acceptance evidence.

## Task 1 — scaffold

| File                | What it shows                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `web-home-page.png` | The `apps/web` placeholder home page rendered in Chrome at `http://127.0.0.1:3000`, showing the Fibonacci deck read from `packages/shared`.  |
| `ci-run-green.png`  | A green CI run with the five distinct jobs — Lint, Typecheck, Unit tests, Integration tests, E2E tests — and the Playwright report artifact. |

## Task 2 — data layer

| File                | What it shows                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migration-run.png` | `npm run migrate -w apps/api` against a freshly created docker-compose Postgres: both migrations applied, a second run reporting no pending migrations (idempotent), and the resulting tables and indexes listed with `psql`. |
