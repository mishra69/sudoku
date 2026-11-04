// Session telemetry: a buffered log of what the player does.
//
// Events are kept in localStorage until the server has them, so nothing is
// lost to an abandoned game, a closed app, being offline or being signed out —
// a batch recorded on the sign-in screen goes up once they've signed in.
// Every event carries the device's time zone, which is how "afternoon" stays
// meaningful for a player who moves from Pacific to India time.

const Telemetry = {
  MAX_BUFFER: 500,
  _flushing: false,

  _tz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
  },

  track(type, data) {
    const buf = Storage.get('events') || [];
    buf.push({ type, at: new Date().toISOString(), tz: this._tz(), ...(data !== undefined && { data }) });
    // Keep the newest if a device stays offline or signed out for a long time.
    Storage.set('events', buf.slice(-this.MAX_BUFFER));
  },

  // keepalive lets the request finish while the app is being backgrounded,
  // which is exactly when the most telling events (a quit, a pause) happen.
  async flush() {
    if (this._flushing || !API._token || !navigator.onLine) return;
    const buf = Storage.get('events') || [];
    if (!buf.length) return;
    this._flushing = true;
    try {
      const res = await fetch(CONFIG.API_BASE + '/events', {
        method: 'POST',
        headers: API._headers(),
        body: JSON.stringify({ events: buf }),
        keepalive: true,
      });
      const renewed = res.headers.get('X-Session-Token');
      if (renewed) API._setToken(renewed);
      if (res.ok) {
        // Drop only what was sent; anything tracked meanwhile stays queued.
        const now = Storage.get('events') || [];
        Storage.set('events', now.slice(buf.length));
      } else if (res.status === 401 && API.onSessionExpired) {
        API._token = null;
        Storage.remove('authToken');
        API.onSessionExpired();
      }
    } catch { /* offline or killed mid-flight: retried next time */ }
    this._flushing = false;
  },

  // What a device can do about notifications, recorded with each open so a
  // missing subscription has an explanation (not installed, denied, ...).
  pushState() {
    try {
      const s = window.Push ? Push.pushSupport().state : 'no-lib';
      const perm = typeof Notification !== 'undefined' ? Notification.permission : 'none';
      return { support: s, permission: perm };
    } catch { return { support: 'error' }; }
  },

  standalone() {
    return !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  },
};
