// Core game state and logic

const Game = {
  state: null,

  // ── Start / Load ──────────────────────────────────────────────────────────

  async start(config) {
    this._lastMoveAt = Date.now();
    const puzzle = await Puzzle.generate(config.difficulty);
    const startingPoints = CONFIG.DIFFICULTIES[config.difficulty].startingPoints;
    const initialGrid = Puzzle.stringToGrid(puzzle.initial);

    // cellTypes: 'prefilled' | 'player' | 'hint' | 'empty'
    const cellTypes = initialGrid.map(row =>
      row.map(v => v !== 0 ? 'prefilled' : 'empty')
    );

    this.state = {
      config,
      puzzle,
      current: initialGrid.map(row => [...row]),
      cellTypes,
      score: startingPoints,
      mistakes: 0,
      hints: 0,
      history: [],
      completed: false,
      gameOver: false,
      startedAt: new Date().toISOString(),
    };

    return this.state;
  },

  loadSaved(saved) {
    this.state = {
      config:       saved.config,
      puzzle:       { initial: saved.puzzle_initial, solution: saved.puzzle_solution, difficulty: saved.config.difficulty },
      current:      JSON.parse(saved.puzzle_current),
      cellTypes:    JSON.parse(saved.cell_types),
      history:      JSON.parse(saved.move_history),
      score:        saved.score_remaining,
      mistakes:     saved.mistakes_count,
      hints:        saved.hints_count,
      completed:    false,
      gameOver:     false,
      startedAt:    saved.started_at,
    };
    return this.state;
  },

  // ── Place a number ────────────────────────────────────────────────────────

  // Returns result object describing what happened
  placeNumber(row, col, num) {
    const { state } = this;
    if (!state || state.completed || state.gameOver) return null;
    if (state.cellTypes[row][col] === 'prefilled') return null;
    if (state.cellTypes[row][col] === 'hint') return null;

    const solution = Puzzle.stringToGrid(state.puzzle.solution);
    const isCorrect = solution[row][col] === num;

    // Must be measured before the placement, while the board still shows what
    // the player was actually looking at.
    const rating = isCorrect ? this.rateMove(row, col, num) : null;

    // Save to history before mutation
    state.history.push({
      row, col,
      oldValue: state.current[row][col],
      oldType: state.cellTypes[row][col],
    });

    if (!isCorrect) {
      state.mistakes++;
      const cost = this._mistakeCost();
      state.score = Math.max(0, state.score - cost);

      // Wrong number is placed temporarily; UI will clear it after animation
      state.current[row][col] = num;
      state.cellTypes[row][col] = 'mistake';

      const limitReached = this._isMistakeLimitReached();
      if (limitReached) {
        state.gameOver = true;
        state.score = 0; // didn't finish — no score
      }

      return { type: 'mistake', cost, mistakes: state.mistakes, limitReached };
    }

    // Correct
    state.current[row][col] = num;
    state.cellTypes[row][col] = 'player';

    const completions = this._checkCompletions(row, col, solution);
    let bonus = 0;
    completions.forEach(c => {
      bonus += CONFIG.SCORING[`BONUS_${c.type.toUpperCase()}`];
    });
    state.score += bonus;

    const isComplete = this._checkPuzzleComplete(solution);
    if (isComplete) {
      state.score += CONFIG.SCORING.BONUS_COMPLETE;
      state.completed = true;
    }

    return { type: 'correct', completions, bonus, isComplete, rating };
  },

  // Clear a mistake cell (called after animation)
  clearMistakeCell(row, col) {
    if (!this.state) return;
    if (this.state.cellTypes[row][col] === 'mistake') {
      this.state.current[row][col] = 0;
      this.state.cellTypes[row][col] = 'empty';
    }
  },

  // ── Hint ──────────────────────────────────────────────────────────────────

  useHint() {
    const { state } = this;
    if (!state || state.completed || state.gameOver) return null;
    if (this._isHintLimitReached()) return null;

    const solution = Puzzle.stringToGrid(state.puzzle.solution);

    // Collect unsolved cells
    const candidates = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (state.cellTypes[r][c] !== 'prefilled' &&
            state.cellTypes[r][c] !== 'hint' &&
            state.current[r][c] !== solution[r][c]) {
          candidates.push({ r, c });
        }
      }
    }
    if (candidates.length === 0) return null;

    state.hints++;
    const cost = this._hintCost();
    state.score = Math.max(0, state.score - cost);

    const { r, c } = candidates[Math.floor(Math.random() * candidates.length)];
    state.current[r][c] = solution[r][c];
    state.cellTypes[r][c] = 'hint';

    // Check if this hint completed the puzzle
    const isComplete = this._checkPuzzleComplete(solution);
    if (isComplete) {
      state.score += CONFIG.SCORING.BONUS_COMPLETE;
      state.completed = true;
    }

    return { row: r, col: c, value: solution[r][c], cost, isComplete };
  },

  // ── Undo ──────────────────────────────────────────────────────────────────

  undo() {
    const { state } = this;
    if (!state || state.history.length === 0) return null;
    const move = state.history.pop();
    state.current[move.row][move.col] = move.oldValue;
    state.cellTypes[move.row][move.col] = move.oldType;
    return move;
  },

  // ── Timer penalty ─────────────────────────────────────────────────────────

  applyTimerPenalty() {
    const { state } = this;
    if (!state || !state.config.timerPressure || state.completed || state.gameOver) return 0;
    const penalty = CONFIG.SCORING.TIMER_PENALTY_PER_MIN;
    state.score = Math.max(0, state.score - penalty);
    return penalty;
  },

  // ── Helpers ───────────────────────────────────────────────────────────────

  _mistakeCost() {
    const { config, mistakes } = this.state;
    if (config.mistakesMode.type === 'limited') return CONFIG.SCORING.MISTAKE_FLAT;
    return CONFIG.SCORING.MISTAKE_BASE_EXP * Math.pow(2, mistakes - 1);
  },

  _hintCost() {
    const { config, hints } = this.state;
    if (config.hintsMode.type === 'limited') return CONFIG.SCORING.HINT_FLAT;
    return CONFIG.SCORING.HINT_BASE_EXP * Math.pow(2, hints - 1);
  },

  _isMistakeLimitReached() {
    const { config, mistakes } = this.state;
    return config.mistakesMode.type === 'limited' && mistakes >= config.mistakesMode.limit;
  },

  _isHintLimitReached() {
    const { config, hints } = this.state;
    return config.hintsMode.type === 'limited' && hints >= config.hintsMode.limit;
  },

  isHintLimitReached() {
    return this.state ? this._isHintLimitReached() : false;
  },

  // ── How hard was that move? ────────────────────────────────────────────────
  // Measured from the board as it stood BEFORE the move, so it has to be called
  // first. The question is how much deduction the placement actually required:
  //
  //   naked single  — only one digit was legal in the cell. Read off, not solved.
  //   hidden single — the digit fitted in only one cell of some row/col/box.
  //                   Findable by scanning; the bread and butter of easy puzzles.
  //   neither       — several digits were legal here, and this digit fitted in
  //                   several cells of every unit. Nothing local determines it,
  //                   so the player reasoned beyond the immediate constraints.
  //
  // That last case is the one worth applauding.
  rateMove(row, col, num) {
    const candidates = this._candidatesFor(row, col);
    if (!candidates.includes(num)) return { tough: false };

    const hidden = this._hiddenSingleUnits(row, col, num);

    // How long they sat on it. This is the honest measure: these puzzles are
    // all solvable by scanning, so difficulty is about *finding* the move, not
    // about technique — and only the player knows how long that took.
    const now = Date.now();
    const thinkMs = this._lastMoveAt ? now - this._lastMoveAt : 0;
    this._lastMoveAt = now;

    // A naked single is read off the board, not deduced — never praise one,
    // however long they took. Anything else needed a scan they had to run.
    const wasReadOff = candidates.length === 1;
    const deliberated = thinkMs >= CONFIG.PRAISE.THINK_MIN_MS &&
                        thinkMs <= CONFIG.PRAISE.THINK_MAX_MS;

    return {
      tough: deliberated && !wasReadOff,
      candidates: candidates.length,
      hiddenSingle: hidden.length > 0,
      thinkMs,
      // Escalate on effort and openness together.
      openness: candidates.length + (thinkMs > 45000 ? 2 : thinkMs > 25000 ? 1 : 0),
    };
  },

  // Reset between games so the first move of a new board isn't credited with
  // the time since the last move of the previous one.
  _lastMoveAt: null,

  // Digits that don't already appear in this cell's row, column or box.
  // Mistakes are ignored — they're about to be cleared and aren't real state.
  _candidatesFor(row, col) {
    const { current, cellTypes } = this.state;
    const taken = new Set();
    const add = (r, c) => {
      const v = current[r][c];
      if (v && cellTypes[r][c] !== 'mistake') taken.add(v);
    };
    for (let i = 0; i < 9; i++) { add(row, i); add(i, col); }
    const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++) for (let c = bc; c < bc + 3; c++) add(r, c);

    const out = [];
    for (let n = 1; n <= 9; n++) if (!taken.has(n)) out.push(n);
    return out;
  },

  // Units where this is the only empty cell `num` could go — i.e. the placement
  // was findable by scanning one row, column or box.
  _hiddenSingleUnits(row, col, num) {
    const { current, cellTypes } = this.state;
    const isEmpty = (r, c) => !current[r][c] || cellTypes[r][c] === 'mistake';
    const fits = (r, c) => isEmpty(r, c) && this._candidatesFor(r, c).includes(num);

    const units = [];
    const rowCells = [], colCells = [], boxCells = [];
    for (let i = 0; i < 9; i++) {
      if (i !== col && fits(row, i)) rowCells.push(i);
      if (i !== row && fits(i, col)) colCells.push(i);
    }
    const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        if ((r !== row || c !== col) && fits(r, c)) boxCells.push([r, c]);
      }
    }
    if (rowCells.length === 0) units.push('row');
    if (colCells.length === 0) units.push('col');
    if (boxCells.length === 0) units.push('box');
    return units;
  },

  _checkCompletions(row, col, solution) {
    const { current } = this.state;
    const completions = [];

    // Row
    if (current[row].every((v, c) => v === solution[row][c])) {
      completions.push({ type: 'row', index: row });
    }
    // Column
    if (current.every((r, ri) => r[col] === solution[ri][col])) {
      completions.push({ type: 'col', index: col });
    }
    // 3x3 box
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    let boxDone = true;
    for (let r = br; r < br + 3 && boxDone; r++) {
      for (let c = bc; c < bc + 3 && boxDone; c++) {
        if (current[r][c] !== solution[r][c]) boxDone = false;
      }
    }
    if (boxDone) completions.push({ type: 'box', boxRow: br, boxCol: bc });

    return completions;
  },

  _checkPuzzleComplete(solution) {
    return this.state.current.every((row, r) =>
      row.every((v, c) => v === solution[r][c])
    );
  },

  // ── Serialization for save/resume ─────────────────────────────────────────

  serialize() {
    const s = this.state;
    return {
      puzzle_initial:  s.puzzle.initial,
      puzzle_solution: s.puzzle.solution,
      puzzle_current:  JSON.stringify(s.current),
      cell_types:      JSON.stringify(s.cellTypes),
      move_history:    JSON.stringify(s.history),
      config:          s.config,
      score_remaining: s.score,
      mistakes_count:  s.mistakes,
      hints_count:     s.hints,
      elapsed_seconds: Timer.elapsed,
      started_at:      s.startedAt,
    };
  },
};
