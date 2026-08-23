// Thin wrapper around sudoku.js (robatron)
// sudoku.js is loaded as a global <script> before this file.

const Puzzle = {
  // Returns { initial, solution, difficulty, id? } — 81-char strings, '.' = empty.
  // Async because the hardest level is fetched rather than generated.
  async generate(difficulty) {
    const spec = CONFIG.DIFFICULTIES[difficulty] || {};
    if (spec.pooled) return this.fromPool(difficulty);

    // Single source of truth: CONFIG.DIFFICULTIES[x].sudokuLevel. This used to
    // be duplicated in a local DIFFICULTY_MAP, which silently won — so adding a
    // difficulty to CONFIG alone produced an easy puzzle under a hard label.
    const level = spec.sudokuLevel || 'easy';
    for (let attempt = 0; attempt < 3; attempt++) {
      const initialStr = sudoku.generate(level);
      const solutionStr = initialStr && sudoku.solve(initialStr);
      if (solutionStr) return { initial: initialStr, solution: solutionStr, difficulty };
    }
    // Bounded, unlike the previous unconditional self-call: a generator that
    // kept failing would recurse until the stack gave out.
    throw new Error("Couldn't generate a puzzle. Please try again.");
  },

  // Pre-generated puzzles live server-side; there is deliberately no local
  // fallback, because substituting an easier puzzle under a harder label is
  // worse than saying the level is unavailable.
  async fromPool(difficulty) {
    const label = CONFIG.DIFFICULTIES[difficulty].label;

    // The buffer first: it makes starting instant, and it is the only path when
    // offline.
    let puzzle = PuzzleCache.take(difficulty);

    if (!puzzle) {
      if (!navigator.onLine) {
        throw new Error(`${label} needs a connection — no puzzles saved for offline play.`);
      }
      const data = await API.getPuzzles(difficulty, PuzzleCache.TARGET);
      const got = (data && data.puzzles) || [];
      if (!got.length) throw new Error(`No ${label} puzzles available right now.`);
      puzzle = got.shift();
      PuzzleCache.add(difficulty, got);   // keep the rest for later
    }

    // Refill in the background — never block starting a game on it.
    PuzzleCache.refill(difficulty);

    return { initial: puzzle.initial, solution: puzzle.solution, difficulty, id: puzzle.id };
  },

  // Convert 81-char string to 9x9 array (0 = empty)
  stringToGrid(str) {
    const grid = [];
    for (let r = 0; r < 9; r++) {
      grid[r] = [];
      for (let c = 0; c < 9; c++) {
        const ch = str[r * 9 + c];
        grid[r][c] = (ch === '.' || ch === '0') ? 0 : parseInt(ch, 10);
      }
    }
    return grid;
  },

  // Convert 9x9 grid back to 81-char string
  gridToString(grid) {
    return grid.map(row => row.map(v => v === 0 ? '.' : String(v)).join('')).join('');
  },
};
