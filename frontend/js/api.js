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

  async register(name, pin) {
    const data = await this._rawFetch('POST', '/auth/register', { name, pin });
    this._token = data.token;
    Storage.set('authToken', data.token);
    Storage.set('playerId', data.playerId);
    Storage.set('playerName', name);
    return data;
  },

  async login(name, pin) {
    const data = await this._rawFetch('POST', '/auth/login', { name, pin });
    this._token = data.token;
    Storage.set('authToken', data.token);
    Storage.set('playerId', data.playerId);
    Storage.set('playerName', name);
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
