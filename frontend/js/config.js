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
    // Retired: Master only existed because `insane` couldn't be generated in a
    // browser. Now that it's pre-generated, 32 givens is a lump between Expert
    // (35) and Insane (26) that makes the top of the ladder lopsided. Kept here
    // — but out of the picker — so historical scores and any half-finished
    // Master game still resolve to a label and a starting score.
    master: { label: 'Master', startingPoints: 10000, sudokuLevel: 32, retired: true },
    // Served from the pre-generated pool: at 26 givens this takes a median 71s
    // of CPU to generate, so it can't be made in the browser. Needs a network
    // connection; there is no local fallback for it.
    insane: { label: 'Insane', startingPoints: 10000, sudokuLevel: 26, pooled: true },
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

  // Only touches and key presses count as activity, so this is really "how
  // long may you stare at the board without touching it". 2 minutes was short
  // enough that thinking through a hard cell paused the timer.
  PRAISE: {
    // Time spent on the move. Below the floor it wasn't really deliberation;
    // above the ceiling they probably put the phone down, and the idle timer
    // (5 min) is too coarse to tell the difference at this scale.
    THINK_MIN_MS:  20 * 1000,
    THINK_MAX_MS: 180 * 1000,
    MIN_TAPS:      4,     // cells inspected before placing — evidence of hunting
    // How much emptier than the board this cell's neighbourhood must be. A
    // fraction, so it means the same thing at every stage of the game.
    MIN_ISOLATION: 0.12,
    SCARCE_ABS:    5,     // "few moves available" in absolute terms
    SCARCE_RATIO:  0.15,  // ...or as a fraction of what's left to fill
    MIN_EMPTY_CELLS: 8,   // the endgame is scarce by arithmetic, not by difficulty
    // Tuned by simulating full games: at 0.1 decay the compliments are the
    // hardest moments but there is only ~1 per game; at 0.4 there are ~3 but
    // diluted. This gives 2-3 on expert/insane at a high average hardness.
    MIN_HARDNESS:  4,    // floor the rising bar decays back to
    BAR_DECAY:     0.25, // how fast the bar eases down per move since the last one
    TIER_MID:      6,    // hardness at which the wording steps up
    TIER_HIGH:     9,
    COOLDOWN_MOVES: 6,   // moves between compliments
    MAX_PER_GAME:   4,   // beyond this it stops meaning anything
    MESSAGES: {
      low:  ['Nice one', 'Good spot', 'Sharp'],
      mid:  ['Brilliant', 'Great deduction', 'Very sharp'],
      high: ['Genius!', 'Outstanding', 'How did you see that?'],
    },
  },

  IDLE_TIMEOUT_MS:        5 * 60 * 1000,   // 5 minutes
  // How often that's checked. At the old 30s the pause could land up to half a
  // minute after the timeout, which made it feel arbitrary.
  IDLE_CHECK_INTERVAL_MS: 10 * 1000,       // 10 seconds
  AUTOSAVE_INTERVAL_MS:   5 * 60 * 1000,   // 5 minutes
  TIMER_PENALTY_INTERVAL_MS: 60 * 1000,    // 1 minute
  MISTAKE_CLEAR_DELAY_MS: 800,              // how long wrong number shows before clearing

  // Same-origin: the Worker serves both this frontend and /api/*.
  API_BASE: '/api',

  // Stamped by deploy.sh at deploy time. 'dev' means running unstamped locally.
  VERSION: '20260903_0027',
};
