-- Session telemetry: what a player actually does, not what they say.
--
--   wrangler d1 execute sudoku-db --remote --file=../migrations/006_events.sql
--
-- With one or two players there's nothing to average; this is a timeline to
-- read. `at` is the device's clock in UTC and `tz` its IANA zone at the time,
-- so "she plays in the afternoon" survives her flying from Pacific to India.

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL,
  at          TEXT    NOT NULL,                 -- when it happened (device clock, UTC ISO)
  received_at TEXT    NOT NULL DEFAULT (datetime('now')),
  tz          TEXT,                             -- e.g. 'Asia/Kolkata'
  type        TEXT    NOT NULL,                 -- app_open, game_start, game_end, ...
  data        TEXT,                             -- JSON details for the type
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_events_player ON events(player_id, at);

-- Latest known time zone, so reminders go out at the player's own afternoon.
ALTER TABLE players ADD COLUMN tz TEXT;
