// DOM rendering and updates

const UI = {
  selectedRow: null,
  selectedValue: null,
  selectedCol: null,

  // ── Grid ──────────────────────────────────────────────────────────────────

  buildGrid() {
    const grid = document.getElementById('sudoku-grid');
    grid.innerHTML = '';

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;

        // Box borders
        if (r % 3 === 0) cell.classList.add('box-top');
        if (c % 3 === 0) cell.classList.add('box-left');
        if (r === 8)     cell.classList.add('box-bottom');
        if (c === 8)     cell.classList.add('box-right');

        cell.addEventListener('click', () => this._onCellClick(r, c));
        grid.appendChild(cell);
      }
    }
  },

  renderGrid(current, cellTypes) {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        this.updateCell(r, c, current[r][c], cellTypes[r][c]);
      }
    }
  },

  updateCell(row, col, value, type) {
    const cell = this.getCell(row, col);
    if (!cell) return;

    cell.textContent = value !== 0 ? value : '';
    cell.className = 'cell';

    // Box borders
    if (row % 3 === 0) cell.classList.add('box-top');
    if (col % 3 === 0) cell.classList.add('box-left');
    if (row === 8)     cell.classList.add('box-bottom');
    if (col === 8)     cell.classList.add('box-right');

    if (type === 'prefilled') cell.classList.add('cell-prefilled');
    if (type === 'hint')      cell.classList.add('cell-hint');
    if (type === 'mistake')   cell.classList.add('cell-mistake');
    if (type === 'player')    cell.classList.add('cell-player');

    if (row === this.selectedRow && col === this.selectedCol) {
      cell.classList.add('cell-selected');
    }

    // Highlight same row/col/box as selection
    if (this.selectedRow !== null) {
      if (row === this.selectedRow || col === this.selectedCol ||
          (Math.floor(row / 3) === Math.floor(this.selectedRow / 3) &&
           Math.floor(col / 3) === Math.floor(this.selectedCol / 3))) {
        cell.classList.add('cell-highlight');
      }
    }

    // Every other instance of the selected digit. Distinct from the row/col/box
    // wash: this one is about the number, so it reads stronger. A mistake is
    // excluded — it's about to be cleared, and matching it would be misleading.
    if (this.selectedValue && value === this.selectedValue && type !== 'mistake') {
      cell.classList.add('cell-same-value');
    }
  },

  getCell(row, col) {
    return document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  },

  selectCell(row, col) {
    const { state } = Game;
    if (!state) return;

    this.selectedRow = row;
    this.selectedCol = col;

    // Drives the same-digit highlight. Tapping a filled cell switches to that
    // digit; tapping an empty one KEEPS the current digit, so "where can this 3
    // go?" survives the tap on the gap you found. A mistake is transient and
    // never becomes the tracked digit.
    const v = state.current[row][col];
    if (v && state.cellTypes[row][col] !== 'mistake') {
      this.selectedValue = v;
    } else if (v) {
      this.selectedValue = null;   // a mistake clears it rather than persisting
    }
    // empty cell: leave selectedValue as it was

    // Re-render to update highlights without rebuilding DOM
    this.renderGrid(state.current, state.cellTypes);

    // Re-apply selected style
    const cell = this.getCell(row, col);
    if (cell) cell.classList.add('cell-selected');
  },

  clearSelection() {
    this.selectedRow = null;
    this.selectedCol = null;
    this.selectedValue = null;
    document.querySelectorAll('.cell').forEach(c => {
      c.classList.remove('cell-selected', 'cell-highlight', 'cell-same-value');
    });
  },

  _onCellClick(row, col) {
    Sound.tap();
    App.cancelHint();   // touching the board means you didn't mean the hint
    const { state } = Game;
    if (!state || state.completed || state.gameOver) return;
    if (state.cellTypes[row][col] === 'prefilled') {
      // Selecting a prefilled still highlights row/col/box
      this.selectCell(row, col);
      return;
    }
    this.selectCell(row, col);
    App.onCellSelected(row, col);
  },

  // ── Number pad ────────────────────────────────────────────────────────────

  buildNumpad() {
    const pad = document.getElementById('numpad');
    pad.innerHTML = '';
    for (let n = 1; n <= 9; n++) {
      const btn = document.createElement('button');
      btn.className = 'num-btn';
      btn.innerHTML = `<span class="num-val"></span><span class="num-count"></span>`;
      btn.querySelector('.num-val').textContent = n;
      btn.dataset.num = n;
      btn.addEventListener('click', () => {
        Sound.tap();
        App.cancelHint();   // a number tap is not a hint confirmation
        App.onNumberInput(n);
      });
      pad.appendChild(btn);
    }
    this.updateNumberCounts();
  },

  // How many of each digit are still to be placed. Call after anything that
  // changes the board.
  updateNumberCounts() {
    const { state } = Game;
    const pad = document.getElementById('numpad');
    if (!state || !pad) return;

    const remaining = new Array(10).fill(9);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = state.current[r][c];
        // A mistake is on the board only until its animation ends, so counting
        // it would make the badge flicker down and back up.
        if (!v || state.cellTypes[r][c] === 'mistake') continue;
        remaining[v]--;
      }
    }

    this._remaining = remaining;

    pad.querySelectorAll('.num-btn').forEach(btn => {
      const left = Math.max(0, remaining[Number(btn.dataset.num)]);
      const badge = btn.querySelector('.num-count');
      if (badge) badge.textContent = left;
      btn.disabled = left === 0;
      btn.classList.toggle('num-btn-done', left === 0);
    });
  },

  // Disabling the button only stops taps; the keyboard reaches onNumberInput
  // directly, and entering a ninth 4 would otherwise be scored as a mistake.
  isNumberExhausted(n) {
    return !!this._remaining && this._remaining[n] <= 0;
  },

  // ── HUD updates ───────────────────────────────────────────────────────────

  updateScore(score) {
    const el = document.getElementById('score-display');
    if (el) el.textContent = score;
  },

  updateMistakes(mistakes, config) {
    const el = document.getElementById('mistake-counter');
    if (!el) return;
    el.textContent = config.mistakesMode.type === 'limited'
      ? `Mistakes ${mistakes}/${config.mistakesMode.limit}`
      : `Mistakes ${mistakes}`;
  },

  updateHints(hints, config) {
    const el = document.getElementById('hint-counter');
    if (!el) return;
    el.textContent = config.hintsMode.type === 'limited'
      ? `💡 ${hints}/${config.hintsMode.limit}`
      : `💡 ${hints}`;
  },

  updateTimer(elapsed) {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = Timer.format(elapsed);
  },

  showIdleIndicator(show) {
    const el = document.getElementById('idle-indicator');
    if (el) el.style.display = show ? 'block' : 'none';
  },

  setHintButtonDisabled(disabled) {
    const btn = document.getElementById('btn-hint');
    if (btn) btn.disabled = disabled;
  },

  // ── Screen switching ──────────────────────────────────────────────────────

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`screen-${id}`);
    if (target) target.classList.add('active');
  },

  // ── Mute toggle ───────────────────────────────────────────────────────────

  updateMuteBtn() {
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = Sound.muted ? '🔇' : '🔊';
  },

  // ── Scoreboard ────────────────────────────────────────────────────────────

  renderScoreboard(scores) {
    const tbody = document.getElementById('scoreboard-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!scores || scores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No games yet. Play your first game!</td></tr>';
      return;
    }
    scores.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(s.completed_at).toLocaleDateString()}</td>
        <td><span class="badge badge-${s.difficulty}">${s.difficulty}</span></td>
        <td class="score-val">${s.final_score}</td>
        <td>${s.mistakes}</td>
        <td>${s.hints_used}</td>
        <td>${Timer.format(s.time_seconds)}</td>
      `;
      tbody.appendChild(tr);
    });
  },

  // ── Game over / Victory screen ────────────────────────────────────────────

  showGameOver(state, elapsedSeconds) {
    document.getElementById('go-title').textContent = state.completed ? 'Puzzle Complete!' : 'Game Over';
    document.getElementById('go-score').textContent = state.score;
    document.getElementById('go-difficulty').textContent = CONFIG.DIFFICULTIES[state.config.difficulty].label;
    document.getElementById('go-mistakes').textContent = state.mistakes;
    document.getElementById('go-hints').textContent = state.hints;
    document.getElementById('go-time').textContent = Timer.format(elapsedSeconds);
    this.showScreen('gameover');
  },

  // ── Theme ─────────────────────────────────────────────────────────────────

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  },

  applyFontSize(size) {
    document.documentElement.setAttribute('data-font-size', size);
  },
};
