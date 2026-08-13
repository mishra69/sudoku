// Keeps the screen awake during play, via the Screen Wake Lock API.
//
// Safari supports this from 16.4. Two things make it fiddlier than it looks:
// iOS silently drops the lock whenever the app is backgrounded and never
// restores it, and requesting one while the document is hidden throws. So the
// desired state ("should the screen stay on?") is tracked separately from the
// sentinel, and re-acquired whenever the page becomes visible again.

const WakeLock = {
  _sentinel: null,
  _wanted: false,

  init() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._acquire();
      // Going hidden needs no action: the platform has already released it.
    });
  },

  enable()  { this._wanted = true;  return this._acquire(); },
  disable() { this._wanted = false; return this._release(); },

  get active() { return !!this._sentinel && !this._sentinel.released; },

  async _acquire() {
    if (!this._wanted) return;
    if (!('wakeLock' in navigator)) return;          // older iOS, and that's fine
    if (document.visibilityState !== 'visible') return;
    if (this.active) return;
    try {
      this._sentinel = await navigator.wakeLock.request('screen');
      // Fires on low battery or platform policy, not just our own release.
      this._sentinel.addEventListener('release', () => { this._sentinel = null; });
    } catch (e) {
      // NotAllowedError is normal — low battery, or backgrounded mid-request.
      // Nothing to recover: the screen just behaves as it would without us.
      this._sentinel = null;
    }
  },

  async _release() {
    const s = this._sentinel;
    this._sentinel = null;
    if (s && !s.released) {
      try { await s.release(); } catch (e) { /* already gone */ }
    }
  },
};
