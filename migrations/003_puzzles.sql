-- Shared, pre-generated puzzle pool.
--
--   wrangler d1 execute sudoku-db --remote --file=../migrations/003_puzzles.sql
--
-- Two reasons puzzles move server-side. The hardest levels cost ~50-75s of CPU
-- to generate, which can't happen in a browser; and a completion rate is only
-- meaningful if more than one person ever sees the same puzzle.

CREATE TABLE IF NOT EXISTS puzzles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  puzzle          TEXT    NOT NULL UNIQUE,  -- 81 chars, '.' for blanks
  solution        TEXT    NOT NULL,         -- 81 chars, all digits
  givens          INTEGER NOT NULL,
  difficulty      TEXT    NOT NULL,         -- nominal label at generation time
  times_served    INTEGER NOT NULL DEFAULT 0,
  times_completed INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    DEFAULT (datetime('now'))
);

-- Serving picks from a difficulty, preferring the least-served puzzle so the
-- pool spreads out instead of everyone drawing the same one.
CREATE INDEX IF NOT EXISTS idx_puzzles_pick ON puzzles(difficulty, times_served);
