const CONFIG = {
  DIFFICULTIES: {
    easy:   { label: 'Easy',   startingPoints: 500,   sudokuLevel: 'easy' },
    medium: { label: 'Medium', startingPoints: 1000,  sudokuLevel: 'medium' },
    hard:   { label: 'Hard',   startingPoints: 2500,  sudokuLevel: 'hard' },
    expert: { label: 'Expert', startingPoints: 5000,  sudokuLevel: 'very-hard' },
    // A raw given-count, not a named level. sudoku.js's own "insane" (25) and
    // "inhuman" (17) never finish generating in reasonable time — measured at
    // >20s — and generation blocks the UI thread. 32 givens is three fewer than
    // very-hard, and measured at median 142ms / max 550ms over 25 runs.
    master: { label: 'Master', startingPoints: 10000, sudokuLevel: 32 },
  },

  SCORING: {
    MISTAKE_FLAT:            50,
    HINT_FLAT:               75,
    MISTAKE_BASE_EXP:        50,
    HINT_BASE_EXP:           75,
    TIMER_PENALTY_PER_MIN:   10,
    BONUS_ROW:               20,
    BONUS_COL:               20,
    BONUS_BOX:               20,
    BONUS_COMPLETE:          100,
  },

  IDLE_TIMEOUT_MS:        2 * 60 * 1000,   // 2 minutes
  AUTOSAVE_INTERVAL_MS:   5 * 60 * 1000,   // 5 minutes
  TIMER_PENALTY_INTERVAL_MS: 60 * 1000,    // 1 minute
  MISTAKE_CLEAR_DELAY_MS: 800,              // how long wrong number shows before clearing

  // Same-origin: the Worker serves both this frontend and /api/*.
  API_BASE: '/api',

  // Stamped by deploy.sh at deploy time. 'dev' means running unstamped locally.
  VERSION: '20260812_2129',
};
