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

## Task 3 — authentication & guest identity

| File                                  | What it shows                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-login-form.png`                 | `/login` in Chrome: email + password form and the "Đăng nhập với Google" button.                                                                |
| `auth-register-form.png`              | `/register` filled in, before submitting.                                                                                                       |
| `auth-signed-in-credentials.png`      | The home page right after that registration: NextAuth session live, `Đã đăng nhập: Khôi Phạm` — a real round-trip through Postgres, not a mock. |
| `auth-guest-name.png`                 | `/join`: a guest types a display name and gets a `participant_id` stored in the browser. No account, no NextAuth, no `users` row.               |
| `auth-google-linked-session.png`      | The app signed in as the **Google-linked** account, after a Google sign-in on the address that already had a password account.                  |
| `auth-google-linked-session-json.png` | `/api/auth/session` for that same session: `id` is the user row created by the password registration, not a second one.                         |

> **Honest labelling for the two Google screenshots:** this project has no Google OAuth client, so
> Google's servers were not contacted. What is simulated is Google's _answer_ (the verified profile
> and account it would return); the linking decision that follows is NextAuth's own
> `callbackHandler` running against the real database, and the session cookie is minted by
> next-auth's own `encode` from the user that handler returned. Decision logged as issue #4.

## Task 4 — rooms: create & join

| File                                  | What it shows                                                                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room-01-home.png`                    | Home (PRD §9 screen 1): the "Tạo phòng mới" button and the join-by-code field.                                                                                                                  |
| `room-02-create-room.png`             | `/rooms/new` (screen 2): room name plus the `fibonacci`/`tshirt` deck choice.                                                                                                                   |
| `room-03-room-after-create.png`       | The room just created (screen 4): name, code, deck, invite link, and the creator seated as host.                                                                                                |
| `room-04-join-by-code.png`            | `/join` (screen 3): typing a room code.                                                                                                                                                         |
| `room-05-join-room-guest.png`         | `/join/[code]` after the code resolved to a real room, asking a guest for a display name.                                                                                                       |
| `room-06-room-with-guest.png`         | The room once that guest is in: their seat is listed, with `room_participants.user_id` NULL.                                                                                                    |
| `room-07-join-room-authenticated.png` | The same screen for a signed-in visitor: the account name is prefilled, and they may still rename themselves for this one room.                                                                 |
| `room-08-room-with-participants.png`  | Three real seats in one room — host, a guest, and a signed-in user — exactly what `GET /rooms/:code/participants` returns (polled every 3s; task 5 below replaces the poll with a socket push). |
| `room-09-join-unknown-code.png`       | An unknown code: a clear error at lookup time, before anyone is asked for a name, and no `room_participants` row written.                                                                       |

## Task 5 — realtime rooms (Socket.io)

Two independent browser contexts (separate localStorage, so two different guests) in one room,
driven by Playwright against the real API, the real Socket.io server and the real database.
Nothing is reloaded between shots — every change is an event arriving on an open socket.

| File                         | What it shows                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `realtime-01-before-lan.png` | **Before.** Browser A (Lan) has joined; the list holds two seats and the badge reads “Trực tiếp” — the socket handshake was accepted.                         |
| `realtime-02-after-lan.png`  | **After,** same tab, never reloaded: Minh appeared the moment browser B joined. This is `participant:joined` arriving on the open socket.                     |
| `realtime-03-after-minh.png` | Browser B at the same moment: its `room:state` snapshot already contains Khôi and Lan, so a newcomer is never missing the people who were there first.        |
| `realtime-04-left-lan.png`   | Browser B closed. After the grace window, browser A shows Minh as “Ngoại tuyến” — `participant:left`, with `room_participants.is_online` flipped in Postgres. |
