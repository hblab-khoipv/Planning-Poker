-- Password credentials for the NextAuth Credentials provider (task 3).
--
-- Deliberately a side table rather than a column on `users`: @auth/pg-adapter's getUser,
-- getUserByEmail and getUserByAccount all run `SELECT * FROM users`, so every extra column on
-- that table flows straight into the AdapterUser object NextAuth puts in the session. A password
-- hash must never ride along, so it lives here and is only ever read by an explicit query.
--
-- One row per user at most: users who only ever sign in with Google simply have no row.

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id       uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- bcrypt modular-crypt string ($2b$<cost>$<salt+digest>), 60 chars today; TEXT so a future
  -- migration to another algorithm/cost does not need a schema change.
  password_hash TEXT NOT NULL CHECK (char_length(password_hash) BETWEEN 20 AND 255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
