# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Project notes

- Product spec: `PRD/PRD_Planning_Poker.md`. Setup, commands and stack rationale: `README.md`.
- npm workspaces monorepo: `apps/web` (Next.js), `apps/api` (Express + Socket.io), `packages/shared`.
- The PRD proposes Supabase; the project deliberately uses the self-hosted alternative
  (Express + Socket.io + own Postgres + NextAuth) because the deployment target is a single EC2 box.
- `packages/shared` is consumed as compiled output — run `npm run build:shared` after editing it,
  and before any typecheck/test/build that touches `apps/*`.
- Integration tests need Postgres: `docker compose up -d` first.
- Lint/typecheck/unit/integration/e2e are five separate CI jobs in `.github/workflows/ci.yml`;
  each maps to a root npm script of the same name. Add test files to the existing directories
  rather than changing CI plumbing.
- Data access goes through `apps/api/src/db/repositories/` (plain typed `pg` query functions, no ORM).
  Every function takes a `Queryable` first argument, so callers pass the pool or one checked-out
  client to compose several writes into a transaction; repositories never BEGIN/COMMIT themselves.
- `users`/`accounts`/`sessions`/`verification_token` follow `@auth/pg-adapter`'s required column
  names verbatim (quoted camelCase included) so task 3 can drop NextAuth in. Two consequences:
  PRD §7's `display_name` is the adapter's `name` column, mapped to `displayName` only in TypeScript,
  and ids are `uuid` rather than the adapter docs' `SERIAL` — safe because the adapter never supplies
  an id on insert. Do not rename these columns to match the PRD.
- Integration tests get fixtures from `apps/api/tests/helpers/seed.ts` (`seedRoomWithRound`,
  `truncateAll`); they build rows through the real repositories, so use them rather than raw INSERTs.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
