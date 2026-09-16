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
  e2e additionally needs **both apps built** (`npm run build`), because `playwright.config.ts`
  starts them with `npm run start` (`next start` serves the last build) and `reuseExistingServer`
  is on locally — so a stale build, or a server left running on 3000/4000, silently tests old UI.
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
  through. Do not emit to a room from anywhere else.
- FR-4's secrecy is structural, not a rule handlers remember. `toRoundStateDto` (`http/dto.ts`) is
  the single choke point every publisher of round state uses — socket snapshot, reveal broadcast,
  `GET /rooms/:code/round` — and it strips values unless the row says `revealed`. The one payload
  naming a value pre-reveal is `room:state.myVote` (the socket's _own_ card), safe only because
  `room:state` goes out with `socket.emit` to one socket. Keep it that way.
- Host authority lives in `http/authority.ts` (`isRoomHost`) and nowhere else: the Host badge in
  the DTO and the reveal/reset gate in `realtime/voting.ts` both call it, so they cannot disagree.
  A room has two host facts and matching **either** is enough — `rooms.host_id` (the account, NULL
  for a guest-created room) or `rooms.host_participant_id` (the creator's seat, migration 0004,
  set for every room). Without the second, guest-created rooms — the primary MVP flow — would have
  no one able to press "Lộ bài". See issue #9; PRD §12 asked the question, MVP answer is host-only.
- "Vote lại" and "Task tiếp theo / Round mới" are one backend action (`round:reset` → a new
  `voting_rounds` row); only the button label differs. PRD §8 lists one event and §7 one record.
- `POST /rooms` opens round 1 in the same transaction that creates the room and seats its host;
  `ensureCurrentRound` covers rooms seeded directly by fixtures.
- Presence is connection-counted, not event-counted (`realtime/presence.ts`): several sockets per
  seat (second tab, reload overlap) announce one join, and the last one closing only counts as a
  departure after `SOCKET_DISCONNECT_GRACE_MS` (default 5s). That window is PRD §12's
  reconnect question answered; the integration suite shrinks it via `attachRealtime`'s `graceMs`.
- `room_participants.is_online` is written by the socket layer on connect and on a grace-expired
  disconnect, so `GET /rooms/:code/participants` and the socket stream cannot disagree. A seat is
  never deleted on disconnect — it still holds a vote.
- Session history (FR-9) is account-only and says so structurally: `db/repositories/history.ts`
  filters on `room_participants.user_id`, which no guest seat (NULL `user_id`) can match, and
  `GET /users/me/rooms` has no id in its path to tamper with. The pure predicate is
  `http/history.ts`'s `canViewRoomHistory` — the neighbour of `http/authority.ts`'s `isRoomHost`.
  History round payloads go through `toRoundStateDto` like everything else, so a never-revealed
  round keeps its cards hidden long after the meeting.
- A browser's API calls must reach the API on the **same hostname as the page**: NextAuth's cookie
  is scoped to a host and ignores the port, so a page on 127.0.0.1 calling `localhost:4000` sends
  no cookie and every authenticated read silently 401s. `apiBaseUrl()` derives the host from
  `window.location` when `NEXT_PUBLIC_API_URL` is unset; do not replace that with a constant.
  For the same reason `playwright.config.ts` hands both e2e servers one `NEXTAUTH_SECRET`.
- The idle-room sweep (PRD §3.1.9/FR-10) is `apps/api/src/jobs/room-cleanup.ts`, started from
  `server.ts` as an in-process interval because the deploy target is one box — no cron entry to
  keep in sync. It deletes from `rooms` only; participants/rounds/votes go by 0002's cascades and
  `users`/`accounts`/`sessions` are permanent (PRD §7), so never widen that DELETE. The threshold
  lives in JS (`staleCutoff`), not in the SQL, which is what makes it unit testable and lets the
  log name the exact cutoff it deleted by. Activity = write paths only (create/join/socket
  connect/vote/reveal/reset, all via `touchRoom`); reads never bump `last_active_at`, so polling
  cannot keep a dead room alive. README has the table and the env vars.
- Integration tests get fixtures from `apps/api/tests/helpers/seed.ts` (`seedRoomWithRound`,
  `truncateAll`); they build rows through the real repositories, so use them rather than raw INSERTs.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
