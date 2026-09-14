-- Planning Poker core schema (PRD §7) plus the NextAuth tables task 3 wires up.
--
-- Every statement is guarded (IF NOT EXISTS / ON CONFLICT), so re-running this file is a no-op
-- even though the runner's schema_migrations ledger already prevents a second apply.
--
-- users/accounts/sessions/verification_token follow @auth/pg-adapter's required column names
-- verbatim (including the quoted camelCase ones). We deviate from the adapter docs' example
-- schema on one point: ids are uuid rather than SERIAL. The adapter never supplies an id on
-- insert -- createUser does `INSERT INTO users (name, email, "emailVerified", image) ...
-- RETURNING id` and relies on the column DEFAULT -- and every other query passes ids as opaque
-- bind parameters, so uuid is safe. It is also the better fit: @auth/core types AdapterUser.id
-- as string, which is what node-postgres returns for uuid (SERIAL would return a number).

-- ---------------------------------------------------------------------------
-- Auth tables (@auth/pg-adapter contract)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The adapter's display-name column. PRD §7 calls this display_name; we keep the adapter's
  -- `name` and surface it as `displayName` in the TypeScript layer instead of carrying both.
  name            VARCHAR(255),
  -- Nullable to match the adapter: some OAuth providers return no email.
  email           VARCHAR(255),
  "emailVerified" TIMESTAMPTZ,
  image           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres allows repeated NULLs in a unique index, so this still permits email-less accounts.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type                VARCHAR(255) NOT NULL,
  provider            VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          BIGINT,
  id_token            TEXT,
  scope               TEXT,
  session_state       TEXT,
  token_type          TEXT
);

-- unlinkAccount() looks an account up by exactly this pair.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_key
  ON accounts (provider, "providerAccountId");
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts ("userId");

CREATE TABLE IF NOT EXISTS sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires        TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_session_token_key ON sessions ("sessionToken");
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions ("userId");

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  token      TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ---------------------------------------------------------------------------
-- Planning Poker tables (PRD §7)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rooms (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The join-link identifier. Generated randomly (see db/room-code.ts), never sequential,
  -- so knowing one room's code tells you nothing about another's.
  code           TEXT NOT NULL CHECK (char_length(code) BETWEEN 4 AND 32),
  name           TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  deck_type      TEXT NOT NULL CHECK (deck_type IN ('fibonacci', 'tshirt')),
  -- Nullable: a guest can host a room, in which case there is no user row to point at.
  host_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rooms_code_key ON rooms (code);
-- Supports the "clean up rooms idle for 24h" sweep in PRD §3.1.9.
CREATE INDEX IF NOT EXISTS rooms_last_active_at_idx ON rooms (last_active_at);

CREATE TABLE IF NOT EXISTS room_participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  -- NULL for guests (PRD §7).
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Per-room display name. Always set for guests; also set for signed-in users who rename
  -- themselves for a single room (PRD §3.1.2).
  guest_name TEXT CHECK (guest_name IS NULL OR char_length(btrim(guest_name)) > 0),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_online  BOOLEAN NOT NULL DEFAULT true,
  -- A participant has to be identifiable as somebody.
  CONSTRAINT room_participants_identity_present CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS room_participants_room_id_idx ON room_participants (room_id);
-- One participant row per signed-in user per room, so rejoining cannot produce a second
-- seat at the table (and therefore a second vote). Guests are excluded because they have no
-- user_id; the browser re-presents its stored participant_id instead (PARTICIPANT_ID_STORAGE_KEY).
CREATE UNIQUE INDEX IF NOT EXISTS room_participants_room_user_key
  ON room_participants (room_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS voting_rounds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      uuid NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  status       TEXT NOT NULL DEFAULT 'voting' CHECK (status IN ('voting', 'revealed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_at  TIMESTAMPTZ,
  -- revealed_at and status cannot disagree about whether the cards are on the table.
  CONSTRAINT voting_rounds_revealed_at_matches_status
    CHECK ((status = 'revealed') = (revealed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS voting_rounds_room_round_number_key
  ON voting_rounds (room_id, round_number);
CREATE INDEX IF NOT EXISTS voting_rounds_room_id_idx ON voting_rounds (room_id);

CREATE TABLE IF NOT EXISTS votes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       uuid NOT NULL REFERENCES voting_rounds (id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES room_participants (id) ON DELETE CASCADE,
  -- A card face from the room's deck ('0', '13', 'XL', '?', '☕'), validated in the data layer
  -- against packages/shared's DECKS before it ever reaches Postgres.
  value          TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 8),
  voted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One vote per participant per round; changing a vote before reveal is an upsert onto this key.
CREATE UNIQUE INDEX IF NOT EXISTS votes_round_participant_key ON votes (round_id, participant_id);
CREATE INDEX IF NOT EXISTS votes_round_id_idx ON votes (round_id);
