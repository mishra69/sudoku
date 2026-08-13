// Thin wrapper around sudoku.js (robatron)
// sudoku.js is loaded as a global <script> before this file.

const Puzzle = {
  // Returns { initial: string, solution: string, difficulty }
  // Both initial and solution are 81-char strings ('.' = empty)
  generate(difficulty) {
    // Single source of truth: CONFIG.DIFFICULTIES[x].sudokuLevel. This used to
    // be duplicated in a local DIFFICULTY_MAP, which silently won — so adding a
    // difficulty to CONFIG alone produced an easy puzzle under a hard label.
    const level = (CONFIG.DIFFICULTIES[difficulty] || {}).sudokuLevel || 'easy';
    const initialStr = sudoku.generate(level);
    const solutionStr = sudoku.solve(initialStr);

    if (!solutionStr) {
      // Rare: retry once
      return this.generate(difficulty);
    }

    return { initial: initialStr, solution: solutionStr, difficulty };
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
