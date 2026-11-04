// Cloud API client

const API = {
  _token: null,
  // Set by App: called when the server rejects our session token.
  onSessionExpired: null,

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this._token) h['Authorization'] = `Bearer ${this._token}`;
    return h;
  },

  async _rawFetch(method, path, body) {
    const res = await fetch(CONFIG.API_BASE + path, {
      method,
      headers: this._headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    // The server renews tokens past half-life on any authenticated response.
    const renewed = res.headers.get('X-Session-Token');
    if (renewed) this._setToken(renewed);
    // A 401 outside /auth/ means the session is dead (expired, or the signing
    // secret changed). Before this, the app kept a stale token forever and
    // every save, score and test push failed with no way out but a logout.
    if (res.status === 401 && !path.startsWith('/auth/') && this._token) {
      this._token = null;
      Storage.remove('authToken');
      if (this.onSessionExpired) this.onSessionExpired();
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  async _fetch(method, path, body) {
    try {
      return await this._rawFetch(method, path, body);
    } catch (e) {
      if (!navigator.onLine) {
        Storage.enqueue({ method, path, body });
        return null;
      }
      throw e;
    }
  },

  // ── Auth ──────────────────────────────────────────────────────────────────

  // Exchange a Google ID token for our own session token.
  async googleSignIn(credential) {
    const data = await this._rawFetch('POST', '/auth/google', { credential });
    this._setToken(data.token);
    Storage.set('playerId', data.playerId);
    Storage.set('playerName', data.name);
    if (data.picture) Storage.set('playerPicture', data.picture);
    return data;
  },

  _setToken(token) {
    this._token = token;
    Storage.set('authToken', token);
  },

  // A stored token counts only if it hasn't expired. The payload is plain
  // base64 JSON, so the expiry is readable here; the server still decides.
  loadStoredAuth() {
    const token = Storage.get('authToken');
    let exp = 0;
    try { exp = JSON.parse(atob(token.split('.')[0])).exp; } catch { /* malformed */ }
    if (!token || !(exp > Date.now())) {
      this._token = null;
      Storage.remove('authToken');
      return false;
    }
    this._token = token;
    return true;
  },

  logout() {
    this._token = null;
    Storage.remove('authToken');
    Storage.remove('playerId');
    Storage.remove('playerName');
    Storage.remove('playerPicture');
  },

  // Records that the player opened the app, and surfaces a dead session early.
  async ping() {
    return this._rawFetch('POST', '/ping');
  },

  // ── Push ──────────────────────────────────────────────────────────────────

  async pushTest() {
    return this._rawFetch('POST', '/push/test');
  },

  // ── Puzzles ───────────────────────────────────────────────────────────────

  async getPuzzles(difficulty, count = 1) {
    return this._rawFetch('GET',
      `/puzzle?difficulty=${encodeURIComponent(difficulty)}&count=${count}`);
  },

  async sendPraiseTelemetry(events) {
    return this._rawFetch('POST', '/telemetry/praise', { events });
  },

  // ── Scores ────────────────────────────────────────────────────────────────

  async saveScore(scoreData) {
    return this._fetch('POST', '/scores', scoreData);
  },

  async getScores(difficulty = null) {
    const q = difficulty ? `?difficulty=${difficulty}` : '';
    return this._fetch('GET', `/scores${q}`);
  },

  // ── Game save / load ──────────────────────────────────────────────────────

  async saveGame(gameData) {
    return this._fetch('POST', '/game/save', gameData);
  },

  async loadGame() {
    return this._fetch('GET', '/game/saved');
  },

  async deleteGame() {
    return this._fetch('DELETE', '/game/saved');
  },
};
