-- Re-engagement reminders, and the bookkeeping to judge whether they work.
--
--   wrangler d1 execute sudoku-db --remote --file=../migrations/005_reminders.sql
--
-- One row per lapse, whether or not a notification went out: a random share of
-- lapsed players are held out (held_out = 1) and get nothing, so their return
-- rate is the baseline. Without it, "40% came back" says nothing — they might
-- have come back anyway. Both groups are tracked identically from sent_at.

CREATE TABLE IF NOT EXISTS reminders (
  id             TEXT    PRIMARY KEY,          -- random; the notification carries it for tap tracking
  player_id      INTEGER NOT NULL,
  sent_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  idle_days      REAL    NOT NULL,             -- days since last activity when chosen
  variant        TEXT    NOT NULL,             -- 'resume' (has a saved game) or 'fresh'
  held_out       INTEGER NOT NULL DEFAULT 0,   -- 1 = control group, nothing sent
  test           INTEGER NOT NULL DEFAULT 0,   -- 1 = sent by hand from the stats page; excluded from stats
  devices_sent   INTEGER NOT NULL DEFAULT 0,   -- push service accepted it
  devices_failed INTEGER NOT NULL DEFAULT 0,
  pruned         INTEGER NOT NULL DEFAULT 0,   -- devices reported gone and deleted
  clicked_at     TEXT,                         -- notification tapped
  returned_at    TEXT,                         -- first signed-in activity afterwards
  played_at      TEXT,                         -- first game saved or finished afterwards
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_reminders_player ON reminders(player_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_reminders_sent ON reminders(sent_at);

-- One row per run of the job, so "is it running at all?" has an answer even
-- on days when nobody was eligible.
CREATE TABLE IF NOT EXISTS reminder_runs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  trigger   TEXT    NOT NULL,                  -- 'cron' or 'manual'
  eligible  INTEGER NOT NULL DEFAULT 0,
  reminded  INTEGER NOT NULL DEFAULT 0,
  held_out  INTEGER NOT NULL DEFAULT 0,
  devices_sent   INTEGER NOT NULL DEFAULT 0,
  devices_failed INTEGER NOT NULL DEFAULT 0,
  pruned    INTEGER NOT NULL DEFAULT 0,
  error     TEXT
);
