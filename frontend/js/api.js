// Cloud API client

const API = {
  _token: null,

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
    this._token = data.token;
    Storage.set('authToken', data.token);
    Storage.set('playerId', data.playerId);
    Storage.set('playerName', data.name);
    if (data.picture) Storage.set('playerPicture', data.picture);
    return data;
  },

  loadStoredAuth() {
    this._token = Storage.get('authToken');
    return !!this._token;
  },

  logout() {
    this._token = null;
    Storage.remove('authToken');
    Storage.remove('playerId');
    Storage.remove('playerName');
    Storage.remove('playerPicture');
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
