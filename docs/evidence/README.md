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
