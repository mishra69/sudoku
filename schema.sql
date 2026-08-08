-- Sudoku App — Cloudflare D1 Schema

CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  pin_hash   TEXT    NOT NULL,
  salt       TEXT    NOT NULL,
  created_at TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scores (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id             INTEGER NOT NULL,
  difficulty            TEXT    NOT NULL,
  final_score           INTEGER NOT NULL,
  time_seconds          INTEGER NOT NULL,
  mistakes              INTEGER NOT NULL,
  hints_used            INTEGER NOT NULL,
  config_mistakes_mode  TEXT    NOT NULL,  -- 'limited:5' or 'unlimited'
  config_hints_mode     TEXT    NOT NULL,  -- 'limited:5' or 'unlimited'
  config_timer_pressure INTEGER NOT NULL,  -- 0 or 1
  completed             INTEGER NOT NULL DEFAULT 0,
  completed_at          TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS saved_games (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id        INTEGER NOT NULL UNIQUE,  -- one saved game per player
  puzzle_initial   TEXT    NOT NULL,         -- JSON 81-char string
  puzzle_solution  TEXT    NOT NULL,         -- JSON 81-char string
  puzzle_current   TEXT    NOT NULL,         -- JSON 9x9 grid array
  cell_types       TEXT    NOT NULL,         -- JSON 9x9 grid ('prefilled','player','hint','empty')
  move_history     TEXT    NOT NULL,         -- JSON array of moves
  config           TEXT    NOT NULL,         -- JSON game config
  score_remaining  INTEGER NOT NULL,
  mistakes_count   INTEGER NOT NULL,
  hints_count      INTEGER NOT NULL,
  elapsed_seconds  INTEGER NOT NULL,
  started_at       TEXT    NOT NULL,
  updated_at       TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_id);
CREATE INDEX IF NOT EXISTS idx_scores_difficulty ON scores(difficulty);
CREATE INDEX IF NOT EXISTS idx_scores_completed_at ON scores(completed_at);
