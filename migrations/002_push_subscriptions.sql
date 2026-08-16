-- Web Push subscriptions, one row per device per player.
--
--   wrangler d1 execute sudoku-db --remote --file=../migrations/002_push_subscriptions.sql
--
-- The endpoint is a capability URL: anyone holding it can push to that device,
-- so it is never logged. It is also the natural primary key — re-subscribing
-- the same device yields the same endpoint, which makes upsert idempotent.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT    PRIMARY KEY,
  player_id    INTEGER NOT NULL,
  subscription TEXT    NOT NULL,   -- full JSON: { endpoint, keys: { p256dh, auth } }
  created_at   TEXT    DEFAULT (datetime('now')),
  last_seen_at TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_push_player ON push_subscriptions(player_id);
