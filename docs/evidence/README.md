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

## Task 6 — voting, reveal and new rounds

Three independent browser contexts (separate storage, so three different people) in one room,
driven by Playwright against the real API, the real Socket.io server and the real database.
Nothing is reloaded between shots — every change is an event arriving on an open socket.

| File                             | What it shows                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voting-01-deck-host.png`        | Round 1 open (PRD §4 step 5): the room's own `fibonacci` deck, nobody has voted, and the host sees “Lộ bài”.                                                             |
| `voting-02-voted-hidden-lan.png` | **FR-4.** All three have voted. Lan sees her own `5` selected and everyone else only as “Đã chọn” — no value of anyone else's is anywhere on her page, and no host control. |
| `voting-03-voted-hidden-host.png`| The same moment on the host's screen: the host is no more privileged than Lan before the reveal.                                                                           |
| `voting-04-revealed-host.png`    | **FR-5/FR-6.** The host pressed “Lộ bài”: every card up (2, 5, 8), trung bình 5, median 5, 3 lượt vote, and no consensus badge.                                          |
| `voting-05-revealed-lan.png`     | The same values and the same numbers on Lan's screen — the reveal is a broadcast, not a host-local view.                                                                  |
| `voting-06-new-round-lan.png`    | **FR-7.** After “Task tiếp theo / Round mới”: round 2, deck open again, and every trace of round 1 gone — no results, no values, nobody marked as having voted.          |
| `voting-07-consensus-minh.png`   | Round 2 reached consensus on 13: the “Đồng thuận” badge, with trung bình/median 13. Reached in round 2, so round 1's values provably cannot have fed this tally.         |
| `voting-08-non-host-lan.png`     | A non-host in a `tshirt` room: the deck is the room's own (sizes, no numbers) and there is no reveal or reset control on the page at all.                                  |
| `voting-09-tshirt-revealed.png`  | A t-shirt reveal: consensus works, and average/median are deliberately absent — FR-6 scopes them to numeric decks.                                                        |
