// Entry point — screen flow, event wiring, auto-save

const App = {
  _autosaveId: null,
  _gameConfig: null,

  // ── Boot ──────────────────────────────────────────────────────────────────

  async init() {
    Storage.loadQueue();
    Sound.load();
    this._showVersion();

    // Apply saved settings
    const settings = Storage.get('settings') || {};
    UI.applyTheme(settings.theme || 'light');
    UI.applyFontSize(settings.fontSize || 'medium');
    this._syncSettingsUI(settings);

    // Try to restore auth
    if (API.loadStoredAuth()) {
      const name = Storage.get('playerName');
      if (name) document.getElementById('welcome-name').textContent = name;
      UI.showScreen('menu');
      this.maybePromptInstall();
    } else {
      UI.showScreen('login');
      Auth.mountButton();
    }

    this._bindGlobalEvents();
    this._checkStaleCache();
    // A new service worker taking over means a new build just landed.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => this._checkStaleCache());
    }

    // Flush any queued offline requests now that we're online
    if (navigator.onLine) await Storage.flushQueue();
    window.addEventListener('online', () => Storage.flushQueue());

    // Debug mode via ?debug=1
    if (new URLSearchParams(location.search).get('debug') === '1') {
      this._mountDebugPanel();
    }
  },

  _showVersion() {
    document.querySelectorAll('[data-version]').forEach(el => {
      el.textContent = CONFIG.VERSION === 'dev' ? 'dev build' : 'v' + CONFIG.VERSION;
    });
  },

  // The service worker caches this page's scripts, so a freshly deployed build
  // can sit behind a stale cache until the new worker activates. Compare what
  // the server has against what we're running and flag the gap.
  async _checkStaleCache() {
    if (CONFIG.VERSION === 'dev' || !navigator.onLine) return;
    try {
      // ?_v= is what makes this bypass the service worker (see sw.js). Without
      // it the probe is served from the same cache the app booted from, so a
      // stale build always looks current.
      const res = await fetch('/js/config.js?_v=' + Date.now(), { cache: 'no-store' });
      const live = (await res.text()).match(/VERSION: '([^']*)'/);
      if (!live || live[1] === CONFIG.VERSION) return;
      document.querySelectorAll('[data-version]').forEach(el => {
        el.textContent = `v${CONFIG.VERSION} — v${live[1]} available, reopen to update`;
      });
    } catch (e) { /* offline or blocked: the version we show is still accurate */ }
  },

  _mountDebugPanel() {
    const panel = document.createElement('div');
    panel.className = 'debug-panel';
    panel.innerHTML = `
      <span class="debug-label">🛠 Debug</span>
      <button onclick="App.debugSolve()">⚡ Solve</button>
      <button onclick="App.debugGameOver()">💥 Game Over</button>
    `;
    document.body.appendChild(panel);
  },

  debugSolve() {
    const { state } = Game;
    if (!state || state.completed || state.gameOver) return;
    const solution = Puzzle.stringToGrid(state.puzzle.solution);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (state.cellTypes[r][c] === 'empty' || state.cellTypes[r][c] === 'player') {
          state.current[r][c] = solution[r][c];
          state.cellTypes[r][c] = 'player';
          UI.updateCell(r, c, solution[r][c], 'player');
        }
      }
    }
    state.score += CONFIG.SCORING.BONUS_COMPLETE;
    state.completed = true;
    setTimeout(() => this._endGame(true), 300);
  },

  debugGameOver() {
    const { state } = Game;
    if (!state || state.completed || state.gameOver) return;
    state.gameOver = true;
    state.score = 0;
    setTimeout(() => this._endGame(false), 100);
  },

  // ── Login ─────────────────────────────────────────────────────────────────
  // Sign-in lives in auth.js — Google's button owns the whole flow and calls
  // back into Auth._onCredential.

  _showLoginError(msg) {
    const el = document.getElementById('login-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  },

  // Only ask to install once someone is signed in — on the login screen the
  // sheet sits on top of the Google button.
  maybePromptInstall() {
    setTimeout(() => { try { PWAInstall.show(); } catch (e) {} }, 2500);
  },

  // ── Game Config ───────────────────────────────────────────────────────────

  showConfig() {
    Sound.tap();
    UI.showScreen('config');
  },

  buildGameConfig() {
    const difficulty = document.querySelector('input[name="difficulty"]:checked')?.value || 'medium';

    const mistakesType = document.querySelector('input[name="mistakes-type"]:checked')?.value || 'unlimited';
    const mistakesLimit = parseInt(document.getElementById('mistakes-limit')?.value || '5', 10);

    const hintsType = document.querySelector('input[name="hints-type"]:checked')?.value || 'unlimited';
    const hintsLimit = parseInt(document.getElementById('hints-limit')?.value || '5', 10);

    const timerPressure = document.getElementById('timer-pressure')?.checked ?? false;

    return {
      difficulty,
      mistakesMode: mistakesType === 'limited' ? { type: 'limited', limit: mistakesLimit } : { type: 'unlimited' },
      hintsMode:    hintsType === 'limited'    ? { type: 'limited', limit: hintsLimit }    : { type: 'unlimited' },
      timerPressure,
    };
  },

  startNewGame() {
    Sound.tap();
    const config = this.buildGameConfig();
    this._gameConfig = config;

    Game.start(config);
    this._setupGameScreen();
    UI.showScreen('game');
    Sound.ready();
    Timer.start(0);
    this._startAutosave();
    this._saveGame(); // persist immediately so Resume works right away
  },

  async resumeGame() {
    Sound.tap();
    try {
      const response = await API.loadGame();
      const saved = response?.saved;
      if (!saved) { alert('No saved game found.'); return; }
      Game.loadSaved(saved);
      this._setupGameScreen();
      UI.showScreen('game');
      Timer.start(saved.elapsed_seconds);
      this._startAutosave();
    } catch (e) {
      alert('Could not load saved game: ' + e.message);
    }
  },

  // ── Pause / Resume overlay ────────────────────────────────────────────────

  pauseGame() {
    Sound.tap();
    Timer.stop();
    this._stopAutosave();
    this._saveGame();
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.style.display = 'flex';
    const btn = document.getElementById('btn-pause');
    if (btn) btn.textContent = '▶';
  },

  resumeFromPause() {
    Sound.tap();
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.style.display = 'none';
    const btn = document.getElementById('btn-pause');
    if (btn) btn.textContent = '⏸';
    Timer.start(Timer.elapsed);
    this._startAutosave();
  },

  quitToMenu() {
    Sound.tap();
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.style.display = 'none';
    const btn = document.getElementById('btn-pause');
    if (btn) btn.textContent = '⏸';
    UI.showScreen('menu');
  },

  _setupGameScreen() {
    const { state } = Game;
    UI.buildGrid();
    UI.buildNumpad();
    UI.renderGrid(state.current, state.cellTypes);
    UI.updateScore(state.score);
    UI.updateMistakes(state.mistakes, state.config);
    UI.updateHints(state.hints, state.config);
    UI.updateTimer(Timer.elapsed);
    UI.showIdleIndicator(false);
    UI.setHintButtonDisabled(Game.isHintLimitReached());
    UI.clearSelection();

    // Difficulty badge
    const badge = document.getElementById('difficulty-badge');
    if (badge) badge.textContent = CONFIG.DIFFICULTIES[state.config.difficulty].label;

    // Timer pressure label
    const timerLabel = document.getElementById('timer-pressure-label');
    if (timerLabel) timerLabel.style.display = state.config.timerPressure ? 'inline' : 'none';

    // Timer callbacks
    Timer.onTick = (elapsed) => UI.updateTimer(elapsed);
    Timer.onIdle = () => {
      UI.showIdleIndicator(true);
      this._saveGame(); // save when going idle
    };
    Timer.onResume = () => UI.showIdleIndicator(false);
    Timer.onPenalty = (penalty) => {
      UI.updateScore(state.score);
      Animations.timerPulse();
      Animations.floatingText(`-${penalty}`, '#f59e0b');
      Sound.tick();
    };
  },

  // ── Cell & Number input ───────────────────────────────────────────────────

  onCellSelected(row, col) {
    // Nothing extra needed — UI.selectCell already handled it
  },

  onNumberInput(num) {
    const { selectedRow: row, selectedCol: col } = UI;
    if (row === null || col === null) return;

    const { state } = Game;
    if (!state || state.completed || state.gameOver) return;
    if (state.cellTypes[row][col] === 'prefilled') return;
    if (state.cellTypes[row][col] === 'hint') return;
    if (UI.isNumberExhausted(num)) return;   // all nine already placed

    const result = Game.placeNumber(row, col, num);
    if (!result) return;

    if (result.type === 'mistake') {
      UI.updateCell(row, col, num, 'mistake');
      Animations.cellMistake(row, col);
      UI.updateMistakes(state.mistakes, state.config);
      Animations.mistakeCounterBump();
      UI.updateScore(state.score);
      Animations.floatingText(`-${result.cost}`);
      Sound.mistake();

      // Clear the wrong number after animation
      setTimeout(() => {
        Game.clearMistakeCell(row, col);
        UI.updateCell(row, col, 0, 'empty');
        UI.updateNumberCounts();
      }, CONFIG.MISTAKE_CLEAR_DELAY_MS);

      if (result.limitReached) {
        setTimeout(() => this._endGame(false), CONFIG.MISTAKE_CLEAR_DELAY_MS + 400);
      }
      return;
    }

    // Correct
    UI.updateCell(row, col, num, 'player');
    UI.updateNumberCounts();
    Animations.cellCorrect(row, col);
    Sound.correct();

    if (result.bonus > 0) {
      Animations.floatingText(`+${result.bonus}`, '#10b981');
    }
    UI.updateScore(state.score);

    result.completions.forEach(comp => {
      if (comp.type === 'row') { Animations.rowComplete(comp.index); Sound.chime(); }
      if (comp.type === 'col') { Animations.colComplete(comp.index); Sound.chime(); }
      if (comp.type === 'box') { Animations.boxComplete(comp.boxRow, comp.boxCol); Sound.chime(); }
    });

    if (result.isComplete) {
      setTimeout(() => this._endGame(true), 600);
    }
  },

  // ── Hint ──────────────────────────────────────────────────────────────────

  // Hints cost points, and the button sits next to the numpad where it's easy
  // to hit by accident — so the first tap only arms it. The second tap, on the
  // separate confirm button, actually spends the hint.
  _hintTimer: null,

  useHint() {
    Sound.tap();
    if (Game.isHintLimitReached()) return;
    const confirm = document.getElementById('hint-confirm');
    if (!confirm) return this.confirmHint();   // markup missing: don't trap the user

    confirm.style.display = '';
    clearTimeout(this._hintTimer);
    // Disarm on its own, so a stray tap doesn't leave a live confirm button
    // sitting there to be hit later.
    this._hintTimer = setTimeout(() => this.cancelHint(), 4000);
  },

  cancelHint() {
    clearTimeout(this._hintTimer);
    this._hintTimer = null;
    const confirm = document.getElementById('hint-confirm');
    if (confirm) confirm.style.display = 'none';
  },

  confirmHint() {
    this.cancelHint();
    const result = Game.useHint();
    if (!result) return;

    const { state } = Game;
    UI.updateCell(result.row, result.col, result.value, 'hint');
    UI.updateNumberCounts();
    Animations.cellHint(result.row, result.col);
    UI.updateScore(state.score);
    UI.updateHints(state.hints, state.config);
    Animations.floatingText(`-${result.cost}`, '#8b5cf6');
    Sound.hint();
    UI.setHintButtonDisabled(Game.isHintLimitReached());

    if (result.isComplete) {
      setTimeout(() => this._endGame(true), 600);
    }
  },

  // ── End game ──────────────────────────────────────────────────────────────

  async _endGame(completed) {
    Timer.stop();
    this._stopAutosave();

    const { state } = Game;

    if (completed) {
      Animations.confetti();
      Sound.victory();
    }

    UI.showGameOver(state, Timer.elapsed);

    // Save score to cloud
    try {
      await API.saveScore({
        difficulty:           state.config.difficulty,
        final_score:          state.score,
        time_seconds:         Timer.elapsed,
        mistakes:             state.mistakes,
        hints_used:           state.hints,
        config_mistakes_mode: state.config.mistakesMode.type === 'limited'
                                ? `limited:${state.config.mistakesMode.limit}` : 'unlimited',
        config_hints_mode:    state.config.hintsMode.type === 'limited'
                                ? `limited:${state.config.hintsMode.limit}` : 'unlimited',
        config_timer_pressure: state.config.timerPressure ? 1 : 0,
        completed:            completed ? 1 : 0,
      });
      await API.deleteGame();
    } catch { /* offline — queued */ }
  },

  // ── Auto-save ─────────────────────────────────────────────────────────────

  _startAutosave() {
    this._stopAutosave();
    this._autosaveId = setInterval(() => this._saveGame(), CONFIG.AUTOSAVE_INTERVAL_MS);
  },

  _stopAutosave() {
    if (this._autosaveId) { clearInterval(this._autosaveId); this._autosaveId = null; }
  },

  async _saveGame() {
    if (!Game.state || Game.state.completed || Game.state.gameOver) return;
    try {
      await API.saveGame(Game.serialize());
    } catch { /* offline — queued */ }
  },

  // ── Settings ──────────────────────────────────────────────────────────────

  saveSettings() {
    const theme    = document.querySelector('input[name="theme"]:checked')?.value || 'light';
    const fontSize = document.querySelector('input[name="font-size"]:checked')?.value || 'medium';
    const sound    = document.getElementById('setting-sound')?.checked ?? true;

    const settings = { theme, fontSize, sound };
    Storage.set('settings', settings);

    UI.applyTheme(theme);
    UI.applyFontSize(fontSize);
    Sound.setMuted(!sound);
    UI.updateMuteBtn();
    Sound.tap();
  },

  _syncSettingsUI(settings) {
    if (settings.theme) {
      const radio = document.querySelector(`input[name="theme"][value="${settings.theme}"]`);
      if (radio) radio.checked = true;
    }
    if (settings.fontSize) {
      const radio = document.querySelector(`input[name="font-size"][value="${settings.fontSize}"]`);
      if (radio) radio.checked = true;
    }
    const soundChk = document.getElementById('setting-sound');
    if (soundChk) soundChk.checked = settings.sound !== false;
  },

  // ── Scoreboard ────────────────────────────────────────────────────────────

  async showScoreboard() {
    Sound.tap();
    UI.showScreen('scoreboard');
    try {
      const data = await API.getScores();
      UI.renderScoreboard(data?.scores || []);
    } catch {
      UI.renderScoreboard([]);
    }
  },

  // ── Logout ────────────────────────────────────────────────────────────────

  logout() {
    API.logout();
    Auth.signOutHint();   // stop Google silently signing us straight back in
    Timer.stop();
    this._stopAutosave();
    Game.state = null;
    const err = document.getElementById('login-error');
    if (err) err.style.display = 'none';
    UI.showScreen('login');
    Auth.mountButton();
  },

  // ── Global event bindings ─────────────────────────────────────────────────

  _bindGlobalEvents() {
    // Save on visibility change (tab switch, home button)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._saveGame();
    });

    // Save before close
    window.addEventListener('beforeunload', () => {
      if (Game.state && !Game.state.completed && !Game.state.gameOver) {
        // Synchronous save not possible — best-effort via beacon
        const payload = JSON.stringify(Game.serialize());
        navigator.sendBeacon(CONFIG.API_BASE + '/game/save', payload);
      }
    });

    // Keyboard input for desktop/external keyboard
    document.addEventListener('keydown', (e) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) this.onNumberInput(num);
    });

    // Config: toggle limit selector visibility
    document.querySelectorAll('input[name="mistakes-type"]').forEach(r => {
      r.addEventListener('change', () => {
        const sel = document.getElementById('mistakes-limit-group');
        if (sel) sel.style.display = r.value === 'limited' && r.checked ? 'flex' : 'none';
      });
    });
    document.querySelectorAll('input[name="hints-type"]').forEach(r => {
      r.addEventListener('change', () => {
        const sel = document.getElementById('hints-limit-group');
        if (sel) sel.style.display = r.value === 'limited' && r.checked ? 'flex' : 'none';
      });
    });
  },
};

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
