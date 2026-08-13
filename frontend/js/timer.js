// Timer with idle detection

const Timer = {
  elapsed: 0,          // total active seconds
  running: false,
  idle: false,
  lastActivity: 0,

  _tickId:    null,
  _penaltyId: null,
  _idleId:    null,

  // Callbacks set by app.js
  onTick:    null,   // (elapsed: number) => void
  onIdle:    null,   // () => void
  onResume:  null,   // () => void
  onPenalty: null,   // (penalty: number) => void

  start(elapsed = 0) {
    this.elapsed = elapsed;
    this.running = true;
    this.idle = false;
    this.lastActivity = Date.now();

    // Second-by-second tick
    this._tickId = setInterval(() => {
      if (!this.idle) {
        this.elapsed++;
        if (this.onTick) this.onTick(this.elapsed);
      }
    }, 1000);

    // Timer pressure penalty every minute
    this._penaltyId = setInterval(() => {
      if (!this.idle) {
        const penalty = Game.applyTimerPenalty();
        if (penalty > 0 && this.onPenalty) this.onPenalty(penalty);
      }
    }, CONFIG.TIMER_PENALTY_INTERVAL_MS);

    this._idleId = setInterval(() => {
      if (!this.idle && Date.now() - this.lastActivity > CONFIG.IDLE_TIMEOUT_MS) {
        this._goIdle();
      }
    }, CONFIG.IDLE_CHECK_INTERVAL_MS);

    this._bindActivity();
  },

  stop() {
    clearInterval(this._tickId);
    clearInterval(this._penaltyId);
    clearInterval(this._idleId);
    this.running = false;
    this._unbindActivity();
  },

  reset() {
    this.stop();
    this.elapsed = 0;
    this.idle = false;
  },

  _goIdle() {
    this.idle = true;
    if (this.onIdle) this.onIdle();
  },

  _wakeUp() {
    this.lastActivity = Date.now();
    if (this.idle) {
      this.idle = false;
      if (this.onResume) this.onResume();
    }
  },

  _handleActivity() {
    // Arrow function would lose `this` — we bind in _bindActivity
    Timer._wakeUp();
  },

  _bindActivity() {
    ['touchstart', 'touchend', 'mousedown', 'keydown'].forEach(e =>
      document.addEventListener(e, Timer._handleActivity, { passive: true })
    );
  },

  _unbindActivity() {
    ['touchstart', 'touchend', 'mousedown', 'keydown'].forEach(e =>
      document.removeEventListener(e, Timer._handleActivity)
    );
  },

  format(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  },
};
