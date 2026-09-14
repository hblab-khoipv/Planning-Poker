-- Baseline schema. Feature tables (rooms, participants, rounds, votes) land in later tasks;
-- this migration only proves the migration runner + Postgres round-trip works end to end.
CREATE TABLE IF NOT EXISTS app_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_metadata (key, value)
VALUES ('schema_baseline', 'planning-poker-mvp')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
