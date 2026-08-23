// Core game state and logic

const Game = {
  state: null,

  // ── Start / Load ──────────────────────────────────────────────────────────

  async start(config) {
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

    return { type: 'correct', completions, bonus, isComplete };
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
