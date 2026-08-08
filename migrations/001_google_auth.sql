-- Replace PIN auth with Google auth.
--
-- DESTRUCTIVE: drops all players, scores and saved games. Run once:
--   wrangler d1 execute sudoku-db --remote --file=../migrations/001_google_auth.sql
--
-- Child tables go first: they carry foreign keys into players.

DROP TABLE IF EXISTS saved_games;
DROP TABLE IF EXISTS scores;
DROP TABLE IF EXISTS players;

CREATE TABLE players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub  TEXT    NOT NULL UNIQUE,
  email       TEXT,
  name        TEXT    NOT NULL,
  picture     TEXT,
  created_at  TEXT    DEFAULT (datetime('now')),
  last_seen_at TEXT   DEFAULT (datetime('now'))
);

CREATE TABLE scores (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id             INTEGER NOT NULL,
  difficulty            TEXT    NOT NULL,
  final_score           INTEGER NOT NULL,
  time_seconds          INTEGER NOT NULL,
  mistakes              INTEGER NOT NULL,
  hints_used            INTEGER NOT NULL,
  config_mistakes_mode  TEXT    NOT NULL,
  config_hints_mode     TEXT    NOT NULL,
  config_timer_pressure INTEGER NOT NULL,
  completed             INTEGER NOT NULL DEFAULT 0,
  completed_at          TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE saved_games (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id        INTEGER NOT NULL UNIQUE,
  puzzle_initial   TEXT    NOT NULL,
  puzzle_solution  TEXT    NOT NULL,
  puzzle_current   TEXT    NOT NULL,
  cell_types       TEXT    NOT NULL,
  move_history     TEXT    NOT NULL,
  config           TEXT    NOT NULL,
  score_remaining  INTEGER NOT NULL,
  mistakes_count   INTEGER NOT NULL,
  hints_count      INTEGER NOT NULL,
  elapsed_seconds  INTEGER NOT NULL,
  started_at       TEXT    NOT NULL,
  updated_at       TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX idx_scores_player ON scores(player_id);
CREATE INDEX idx_scores_difficulty ON scores(difficulty);
CREATE INDEX idx_scores_completed_at ON scores(completed_at);
CREATE INDEX idx_players_google_sub ON players(google_sub);
