// Web Audio API sound engine — no audio files needed

const Sound = {
  ctx: null,
  muted: false,

  _getCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browsers require user gesture)
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  _tone(frequency, type, duration, volume = 0.3, startTime = null) {
    if (this.muted) return;
    const ctx = this._getCtx();
    const start = startTime ?? ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.start(start);
    osc.stop(start + duration);
  },

  // Soft click when placing a correct number
  correct() {
    this._tone(880, 'sine', 0.1, 0.2);
  },

  // Low buzz for a mistake
  mistake() {
    if (this.muted) return;
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    this._tone(180, 'sawtooth', 0.15, 0.25, now);
    this._tone(160, 'sawtooth', 0.15, 0.2, now + 0.08);
  },

  // Bright short chime for row/col/box completion
  chime() {
    if (this.muted) return;
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    [523, 659, 784].forEach((freq, i) => {
      this._tone(freq, 'sine', 0.25, 0.25, now + i * 0.1);
    });
  },

  // Swoosh for hint reveal
  hint() {
    if (this.muted) return;
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.linearRampToValueAtTime(800, now + 0.15);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  },

  // Subtle timer tick
  tick() {
    this._tone(660, 'sine', 0.05, 0.08);
  },

  // Victory fanfare
  victory() {
    if (this.muted) return;
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const melody = [
      { freq: 523, dur: 0.15, t: 0 },
      { freq: 659, dur: 0.15, t: 0.15 },
      { freq: 784, dur: 0.15, t: 0.30 },
      { freq: 1047, dur: 0.4,  t: 0.45 },
      { freq: 784, dur: 0.15, t: 0.55 },
      { freq: 1047, dur: 0.6,  t: 0.70 },
    ];
    melody.forEach(({ freq, dur, t }) => {
      this._tone(freq, 'sine', dur, 0.3, now + t);
    });
  },

  // Game start ready sound
  ready() {
    if (this.muted) return;
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    this._tone(440, 'sine', 0.1, 0.2, now);
    this._tone(554, 'sine', 0.1, 0.2, now + 0.12);
  },

  // Button tap
  tap() {
    this._tone(600, 'sine', 0.05, 0.1);
  },

  setMuted(val) {
    this.muted = val;
    Storage.set('soundMuted', val);
  },

  load() {
    this.muted = Storage.get('soundMuted') ?? false;
  },
};
