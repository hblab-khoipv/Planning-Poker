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
  no one able to press "Lật bài". See issue #9; PRD §12 asked the question, MVP answer is host-only.
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
- Changing a card after the reveal is a second, separate action (`vote:edit` → `vote:edited`,
  issue #11) — never `vote:cast` aimed at a revealed round. Neither request carries a participant
  id, so "only the owner may edit their own card" is the absence of a parameter rather than a
  check; `votes.original_value`/`edited_at` (migration 0006) are the evidence, written with
  `COALESCE(original_value, value)` so a second edit still points at the card the room first saw.
  PRD FR-4 allows changing a vote only _before_ the reveal — see issue #19 for that delta.
- The room screen is a table (`components/room-table.tsx`), and the two rules with edge cases live
  apart from it as pure functions with unit tests: `lib/table-seats.ts` (who sits where, host in
  the middle of the near edge) and `lib/vote-chart.ts` (the reveal distribution, issue #12).
  The reveal chart is hand-drawn Tailwind on purpose — no charting library.
- Whether a screen may offer sign-in, sign-up or guest identity is decided in one place,
  `apps/web/src/lib/identity-cta.ts`, and nowhere else: `useSession()`'s three statuses map onto
  `loading | signed-in | guest`, and only `guest` may be offered any of them. `loading` is its own
  state on purpose — treating it as signed-out flashes a sign-in button at somebody who is signed
  in, which is the bug the module exists to prevent (issue #23). The consumers are
  `components/identity-section.tsx` (home), `components/sign-in-prompt.tsx` (the join screens) and
  `components/already-signed-in.tsx` (what `/login` and `/register` show instead of their form).
  Signing in stays optional (PRD §3.1.1) — this changes presentation only.
- Colour in `apps/web` is never a raw Tailwind palette step: `src/app/globals.css` defines the
  tokens (`--ink`, `--surface`, `--brand`, `--felt`, …) and `tailwind.config.ts` names them as
  `text-ink-muted`, `bg-surface`, `border-line` and so on. Light is the default and the theme the
  WCAG AA 4.5:1 contrast targets are checked against; the dark set is opt-in via `data-theme="dark"`
  on `<html>` and deliberately NOT wired to `prefers-color-scheme` (issue #26). Theming is purely
  CSS-variable swapping, so there is no Tailwind `darkMode` option and no `dark:` variant. Add a
  colour by adding a token, never by reaching for `slate-800` again.
- The room screen fits one laptop screen with no page scroll, and that is a tested contract:
  `apps/web/e2e/layout.spec.ts` measures `scrollHeight - clientHeight` at 1366x768 and 1440x900 in
  both the voting and revealed states. The mechanism is `lg:h-[100dvh] lg:overflow-hidden` on
  `main` plus exactly one growing child (the table); the header (incl. the round-story editor) and
  the footer band (emoji bar and the round-history panel) are `shrink-0`, and the results are a
  side rail, not another row — a rail whose width is **reserved whether or not a round is
  revealed**, which is what keeps the "Bàn estimate" frame one fixed size through a reveal. Below
  `lg` it falls back to normal flow and scrolls. Anything added to that screen must go inside an
  existing band or it will break the spec. The deck, its hint and the host's round controls live
  _inside_ that frame below the seats (`RoomTable`'s `footer` prop; the controls ride on the
  deck's heading line because a row of nine cards plus two buttons does not fit the frame).
  The seat list scrolls inside the table and uses
  `[justify-content:safe_center]`, never `justify-center`: plain centring puts a crowded room's top
  row above the scroll origin, unreachable — the spec's 8-seat (post-reveal) and 30-seat cases guard it.
  Sharp edge: every seat is `relative`, because Tailwind's `.sr-only` is `position: absolute` and a
  span whose containing block sits outside the scrolling seat list escapes that list's clipping and
  silently makes the whole page scroll by a few pixels.
- `apps/web`'s unit suite is `src/**/*.test.ts` in a _node_ environment: there is no React testing
  library here, so logic worth asserting belongs in `src/lib/` rather than inside a component.
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
- The **hand deploy** is the live path (docs/deployment.md §7): `deploy/scripts/push-from-laptop.sh`
  builds on the operator's laptop and rsyncs `stage-release.sh`'s tree to the box;
  `deploy/scripts/restart-on-box.sh` installs prod deps only when the manifests changed, migrates,
  restarts (systemd units if installed, else pidfile-tracked background processes) and refuses to
  report success without a 2xx from `/health` and `/`. The build is on the laptop because
  `NEXT_PUBLIC_API_URL` is inlined at build time. Config is `deploy/env/{laptop-push,box-restart}.env`
  (git-ignored; `.example` files are committed) — nothing about the box is in a script.
  Production runs behind an **ALB**, not nginx: target groups on 3000/4000, API health check on
  `/health` (never `/health/db` — a database blip would deregister the instance), and sticky
  sessions become mandatory past one instance because Socket.io presence is per-process.
- Deployment lives in `deploy/` + `.github/workflows/deploy.yml`, documented in `docs/deployment.md`.
  That CI path stays simulated (`DEPLOY_SIMULATE=true`): merging to `main` does not touch the
  server, and `deploy/scripts/bootstrap-server.sh` — Ubuntu/`apt-get` + nginx + certbot only, so
  wrong for the Amazon Linux box — has never been executed.
  `deploy/scripts/lib.sh`'s `run_step` is the ONLY place the `DEPLOY_SIMULATE` repository variable
  is consulted — one script, two modes, so a simulated run is a real rehearsal of the live path.
  Anything other than the literal `false` keeps simulation on. Never echo a secret: command lines
  are printed from a display string built with `secret_ref`, never from the executed argv.
- Production cannot put both apps on one hostname: the web app serves `/rooms/:code` as a page and
  the API serves `/rooms/:code` as JSON. The API therefore gets `api.<domain>`, and
  `AUTH_COOKIE_DOMAIN` (`apps/web/src/server/auth/cookie-domain.ts`) widens only NextAuth's session
  cookie to the registrable domain so the API can still recognise a signed-in caller. Unset — local
  and CI — means NextAuth's defaults, unchanged.
- `NEXT_PUBLIC_API_URL` is baked into the browser bundle by `next build`, so changing it needs a
  rebuild, not a restart; it is set in the deploy workflow's build job as well as in `web.env`.
- Who a thrown emoji is aimed at is picked by **clicking the person's seat** (`seat-target`, a real
  button with `aria-pressed`, click again or "Cả bàn" to go back to the table) — the emoji bar only
  keeps the way back and the readout. A seat-bound emoji lands _on the card_ (`reaction-land` in
  `globals.css`): any landing spot above the card is clipped away by the seat list's scrollbox.
- Thrown emoji (`realtime/reactions.ts` + `web/src/lib/reactions.ts`) are the one feature that
  touches no round: nothing is persisted, `touchRoom` is deliberately not called (cheering must
  not keep an idle room alive), and the palette + rate limit live in `packages/shared`'s
  `reactions.ts` so the buttons a browser renders are exactly what the server accepts.
- A room's score history is not a second store: it _is_ `voting_rounds` + `votes`, which 0002
  cascades from `rooms`, so the FR-10 sweep is also its retention (≤ 24h) with nothing extra to
  configure. `voting_rounds.story` (migration 0007, host-only `round:story` → `round:updated`) is
  the one round fact nothing else could reconstruct afterwards. One endpoint serves both readers:
  `GET /rooms/:code/rounds` answers FR-9's account-scoped screens _and_ the in-room panel, the
  latter via `?participantId=` — the same seat credential the socket handshake takes, so
  `canViewRoomHistory` grants a guest nothing the live socket had not already streamed them.
- Export is browser-side by design: `packages/shared/src/export.ts` turns the history payload the
  server already sent into CSV/Markdown, so there is no export endpoint whose authorisation could
  drift from the history one, and no chance of a number the room never saw. Keep the formatters
  pure and in `shared`; `apps/web/src/lib/room-export.ts` is only the Blob/clipboard plumbing.
- Integration tests get fixtures from `apps/api/tests/helpers/seed.ts` (`seedRoomWithRound`,
  `truncateAll`); they build rows through the real repositories, so use them rather than raw INSERTs.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
