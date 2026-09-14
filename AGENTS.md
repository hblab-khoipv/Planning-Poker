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
- Integration and e2e tests both need Postgres (`docker compose up -d` + `npm run migrate`);
  e2e additionally needs `apps/api` **built**, because `playwright.config.ts` starts the API and
  the web app as two `webServer` entries and the browser drives the real REST endpoints.
  That config is loaded as CommonJS — `import.meta` does not work in it.
- Lint/typecheck/unit/integration/e2e are five separate CI jobs in `.github/workflows/ci.yml`;
  each maps to a root npm script of the same name. Add test files to the existing directories
  rather than changing CI plumbing.
- Data access goes through `apps/api/src/db/repositories/` (plain typed `pg` query functions, no ORM).
  Every function takes a `Queryable` first argument, so callers pass the pool or one checked-out
  client to compose several writes into a transaction; repositories never BEGIN/COMMIT themselves.
- `users`/`accounts`/`sessions`/`verification_token` follow `@auth/pg-adapter`'s required column
  names verbatim (quoted camelCase included), which is what let NextAuth (below) drop in without a
  migration. Two consequences:
  PRD §7's `display_name` is the adapter's `name` column, mapped to `displayName` only in TypeScript,
  and ids are `uuid` rather than the adapter docs' `SERIAL` — safe because the adapter never supplies
  an id on insert. Do not rename these columns to match the PRD.
- Auth lives in `apps/web` (NextAuth v4 + `@auth/pg-adapter`), not in `apps/api`: it runs in the
  Next.js server runtime, so `apps/web/src/server/db/pool.ts` is a second pool onto the _same_
  database. `apps/api` still owns the schema and migrations — never add a migration under `apps/web`.
- Password hashes live in `user_credentials`, never on `users`: the adapter runs `SELECT * FROM users`
  in three of its methods, so any column added there lands in the NextAuth session object.
- Sessions are JWT, not database rows — next-auth v4 refuses database sessions once a Credentials
  provider is configured. `sessions` still exists and is exercised by the adapter tests.
- Google uses `allowDangerousEmailAccountLinking` so one person is one `users` row; the `signIn`
  callback refuses any Google profile with `email_verified !== true`, which is what makes that safe.
  Changing either without the other reopens an account-takeover path.
- Objects in `authOptions.providers` are **not** what NextAuth runs: `GoogleProvider(...)` /
  `CredentialsProvider(...)` stash the caller's settings under `.options` and NextAuth merges them
  in per request. Tests must go through `apps/web/tests/helpers/next-auth-internals.ts`, which also
  loads next-auth's real `callbackHandler` for the account-linking gate (issue #2).
- REST lives in `apps/api/src/routes/` with the plumbing in `src/http/`: `errors.ts` maps the data
  layer's `ValidationError`/`ConflictError` onto statuses (routes just call repositories and let it
  throw), `dto.ts` is the only place row shapes become wire shapes, and `withTransaction` in
  `src/db/transaction.ts` is how a route composes several repository writes.
- `apps/api` authenticates a caller by decrypting NextAuth's session cookie itself
  (`src/http/session.ts`, via `next-auth/jwt`) with the `NEXTAUTH_SECRET` that `apps/web` uses —
  never from a user id in the request body. An absent/invalid secret or cookie means "guest",
  never an error. Tests mint cookies with next-auth's own `encode`.
- Anything both sides of the wire must agree on goes in `packages/shared`: deck definitions, the
  REST DTOs, display-name rules, and the room-code alphabet/parsing (`generateRoomCode` stays in
  `apps/api` because it needs a CSPRNG). Changing a rule in only one app is the bug this prevents.
- A guest has no `user_id` for the server to key on, so `POST /rooms/:code/join` returns the seat
  id and the browser stores it **per room** (`apps/web/src/lib/room-membership.ts`) — one browser
  can hold seats in several rooms, so the single `participant_id` from the guest identity cannot
  be the `room_participants.id`.
- Realtime lives in `apps/api/src/realtime/`, alongside REST rather than instead of it: REST still
  creates rooms and seats people, and a socket may only pick up a seat that already exists.
  `identity.ts` resolves a handshake (NextAuth cookie for members, stored seat id for guests) and
  refuses anything else _before_ `connection` fires, so an unauthenticated socket never joins a
  channel. It takes a `ParticipantLookup`, not a pool, which is what makes that decision unit
  testable without a database.
- Every server→room broadcast goes through `realtime/channel.ts`. That is deliberate: `vote:cast`
  is built there from a participant id and there is no parameter a vote value could arrive
  through, which is how FR-4's secrecy survives task 6. Do not emit to a room from anywhere else.
- Presence is connection-counted, not event-counted (`realtime/presence.ts`): several sockets per
  seat (second tab, reload overlap) announce one join, and the last one closing only counts as a
  departure after `SOCKET_DISCONNECT_GRACE_MS` (default 5s). That window is PRD §12's
  reconnect question answered; the integration suite shrinks it via `attachRealtime`'s `graceMs`.
- `room_participants.is_online` is written by the socket layer on connect and on a grace-expired
  disconnect, so `GET /rooms/:code/participants` and the socket stream cannot disagree. A seat is
  never deleted on disconnect — it still holds a vote.
- Integration tests get fixtures from `apps/api/tests/helpers/seed.ts` (`seedRoomWithRound`,
  `truncateAll`); they build rows through the real repositories, so use them rather than raw INSERTs.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
