-- Telemetry for the "hard move" detector.
--
--   wrangler d1 execute sudoku-db --remote --file=../migrations/004_praise_events.sql
--
-- Every signal that fed a decision is stored, including the ones that were
-- eligible but suppressed by the rising bar. Tuning has so far been done
-- against simulated play, which cannot model how a person actually hunts for a
-- move; this is what replaces that guesswork with real games.

CREATE TABLE IF NOT EXISTS praise_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    INTEGER NOT NULL,
  difficulty   TEXT    NOT NULL,
  puzzle_id    INTEGER,              -- null for locally generated puzzles
  shown        INTEGER NOT NULL,     -- 1 displayed, 0 eligible but held back
  message      TEXT,
  hardness     REAL,
  isolation    REAL,                 -- how much emptier than the board this cell was
  peers_filled INTEGER,              -- of 20
  board_filled REAL,                 -- fraction of the grid filled at the time
  candidates   INTEGER,
  available    INTEGER,              -- placements available anywhere on the board
  empty_cells  INTEGER,
  think_ms     INTEGER,
  taps         INTEGER,
  move_index   INTEGER,              -- which move of the game
  bar          REAL,                 -- the threshold it was judged against
  created_at   TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_praise_player ON praise_events(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_praise_difficulty ON praise_events(difficulty, shown);
