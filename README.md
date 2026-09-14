# Planning Poker

Real-time story point estimation for agile teams. See [`PRD/PRD_Planning_Poker.md`](PRD/PRD_Planning_Poker.md) for the full product spec.

> **Status:** rooms can be created and joined. On top of the monorepo layout, CI pipeline, Postgres schema/data-access layer and NextAuth sign-in, the app now has the room REST API (`POST /rooms`, `GET /rooms/:code`, `POST /rooms/:code/join`, `GET /rooms/:code/participants`) and the screens for it: home, create room, join room, and a room page with a polled participant list. Realtime sync (Socket.io), voting, reveal and session history are implemented in follow-up tasks.

## Stack

| Layer          | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Frontend       | Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS         |
| Backend        | Node.js + Express + Socket.io + TypeScript                             |
| Database       | PostgreSQL 16                                                          |
| Auth           | NextAuth v4 (email/password + Google OAuth) + `@auth/pg-adapter`       |
| Guest identity | Client-stored `participant_id`, no account required                    |
| Shared code    | `packages/shared` — deck definitions, socket event names, shared types |

The PRD proposed Supabase as one option. We deliberately chose the **self-hosted alternative** (Express + Socket.io + own Postgres + NextAuth) because the deployment target is a **single EC2 instance running both frontend and backend**, not a managed platform.

## Repository layout

```
apps/
  api/       Express + Socket.io backend (TypeScript, ESM)
  web/       Next.js frontend (App Router, Tailwind)
packages/
  shared/    Types & constants shared by api and web (decks, socket events)
.github/
  workflows/ci.yml   lint / typecheck / unit / integration / e2e jobs
docker-compose.yml   local PostgreSQL
```

### Why npm workspaces (and not pnpm)

We use **npm workspaces**. The reasoning:

- npm ships with Node, so no extra package manager has to be installed on dev machines, in CI, or on the EC2 host we deploy to in task 10 — one less moving part in the provisioning script.
- `actions/setup-node` caches npm lockfiles natively, so CI needs no additional setup step.
- The dependency graph here is small (two apps, one shared package); pnpm's main advantages (disk dedup at scale, strict peer isolation) do not pay for the extra toolchain requirement.

The tradeoff is npm's flat, non-strict `node_modules` — a package can import a transitive dependency it never declared. We accept that for a three-package repo.

## Prerequisites

- Node.js >= 20 (CI runs 22)
- Docker + Docker Compose
- npm >= 10

## Getting started

```bash
# 1. Environment variables
cp .env.example .env

# 2. Start PostgreSQL
docker compose up -d

# 3. Install dependencies (root — installs every workspace)
npm install

# 4. Build the shared package (apps resolve it from packages/shared/dist)
npm run build:shared

# 5. Apply database migrations
npm run migrate --workspace @planning-poker/api

# 6. Run both dev servers
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:4000 — try `GET /health` and `GET /health/db`

Run the servers individually with `npm run dev:web` / `npm run dev:api`.

> `npm run build:shared` must be re-run after editing `packages/shared`. Apps consume its compiled `dist/` output.

## Authentication and identity

Two kinds of people use a room, and they are kept apart on purpose (PRD §3.1.2, FR-2, FR-8).

**Signed-in users** go through NextAuth v4, configured in `apps/web/src/server/auth/options.ts`:

- **Email + password** — a NextAuth Credentials provider. Sign-up is `POST /api/register` (NextAuth
  has no sign-up concept of its own); passwords are bcrypt hashes in the `user_credentials` table,
  never a column on `users` (the adapter does `SELECT * FROM users`, so anything stored there ends
  up in the session object).
- **Google** — standard OAuth. Signing in with Google on an address that already has a password
  account **links to the same `users` row** rather than creating a second one, via the adapter's
  `accounts` table. A Google profile whose email is not verified is refused before that can happen.
- Sessions are **JWT**, not database rows: next-auth v4 refuses database sessions when a Credentials
  provider is enabled. The adapter still owns `users`, `accounts` and OAuth linking.

Set up Google locally by creating an OAuth client (type "Web application") in the Google Cloud
console with `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI, then
put its id and secret in `.env`. With those variables empty the button disappears and everything
else still works.

**Guests** never touch NextAuth or the `users` table. The join screen asks for a display name and
stores it with a random `participant_id` in the browser (`apps/web/src/lib/guest-identity.ts`);
`POST /rooms/:code/join` turns that into a `room_participants` row with `user_id` NULL.

The API identifies a signed-in caller by decrypting NextAuth's session cookie itself
(`apps/api/src/http/session.ts`), using the `NEXTAUTH_SECRET` both processes share — so a user id
is never taken from the request body. The web app and the API are the same site (cookies ignore
the port), which holds for the single-host deployment target as well as for local dev. With no
secret configured the API simply treats everybody as a guest.

## Rooms

`POST /rooms` mints a random 8-character join code (`apps/api/src/db/room-code.ts`), never a
sequential id (PRD §10), and seats the creator in the same transaction — as host when they are
signed in. Joining is idempotent on both sides: a signed-in user is matched on `user_id` by the
partial unique index from task 2, and a guest's browser re-presents the `room_participants.id`
it stored for that room (`apps/web/src/lib/room-membership.ts`), so a reload never costs a second
seat — or, from task 6, a second vote.

| Endpoint                        | Purpose                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `POST /rooms`                   | Create a room and seat the creator (FR-1)                    |
| `GET /rooms/:code`              | Resolve a join code, so a mistyped one fails before the name |
| `POST /rooms/:code/join`        | Take a seat in the room (FR-2)                               |
| `GET /rooms/:code/participants` | The participant list (FR-3, polled until task 5 pushes it)   |

Screens: `/` (create or enter a code), `/rooms/new`, `/join` → `/join/[code]`, `/rooms/[code]`.

## Database

`docker compose up -d` brings up PostgreSQL 16 on port `5432` (override with `POSTGRES_PORT`) with database/user/password all defaulting to `planning_poker`. Data lives in the `postgres-data` named volume.

```bash
docker compose up -d       # start
docker compose logs -f     # tail logs
docker compose down        # stop (keeps data)
docker compose down -v     # stop and wipe the volume
```

Migrations are plain `.sql` files in `apps/api/src/db/migrations/`, applied in filename order by `apps/api/src/db/migrate.ts`. Each one runs in its own transaction alongside its `schema_migrations` bookkeeping row, and re-running is a no-op.

```bash
npm run migrate --workspace @planning-poker/api
```

## Tests

Every category runs as its own CI job and can be run locally the same way.

| Category    | Command                    | Tool                       | Needs                    |
| ----------- | -------------------------- | -------------------------- | ------------------------ |
| Lint        | `npm run lint`             | ESLint 9 (flat) + Prettier | —                        |
| Typecheck   | `npm run typecheck`        | tsc (all workspaces)       | —                        |
| Unit        | `npm run test:unit`        | Vitest + supertest         | —                        |
| Integration | `npm run test:integration` | Vitest + `pg`              | `docker compose up -d`   |
| E2E         | `npm run test:e2e`         | Playwright (Chromium)      | Postgres + built api/web |

```bash
# Formatting
npm run format          # write
npm run format:check    # verify (what CI runs)

# Unit — API routes and shared package contracts, no external services
npm run test:unit

# Integration — real migrations + real queries against the docker-compose Postgres
docker compose up -d
npm run test:integration

# E2E — drives the real room flow in a real browser, against the real API and database
docker compose up -d
npm run migrate --workspace @planning-poker/api
npm run build --workspace @planning-poker/api
npm run build --workspace @planning-poker/web
npm run test:e2e:install --workspace @planning-poker/web   # once, downloads Chromium
npm run test:e2e
```

Playwright starts both servers itself (`playwright.config.ts` → `webServer`), reusing already-running ones locally. Override the targets with `E2E_BASE_URL` / `E2E_PORT` / `E2E_API_PORT`.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request as **five independent jobs**: `lint`, `typecheck`, `unit`, `integration` and `e2e` (the last two each with a Postgres service container; `e2e` also builds and starts the API, and uploads its Playwright HTML report as an artifact). Adding test files to the existing directories requires no CI changes.

## Environment variables

See [`.env.example`](.env.example). Notable ones:

| Variable                                   | Used by | Purpose                                                                       |
| ------------------------------------------ | ------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                             | api     | PostgreSQL connection string                                                  |
| `PORT`                                     | api     | API port (default 4000)                                                       |
| `CORS_ORIGIN`                              | api     | Allowed browser origins, comma-separated (default: the web dev URLs)          |
| `NEXT_PUBLIC_API_URL`                      | web     | API base URL exposed to the browser                                           |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET`          | web+api | NextAuth — required; the API verifies the session cookie with the same secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | web     | Google sign-in; leave empty to run with email/password only                   |
| `DATABASE_URL`                             | web     | NextAuth adapter — the same database the API uses                             |
