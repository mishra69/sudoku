// LocalStorage helpers + offline API queue

const Storage = {
  get(key) {
    try {
      const v = localStorage.getItem(`sudoku:${key}`);
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  },

  set(key, value) {
    try {
      localStorage.setItem(`sudoku:${key}`, JSON.stringify(value));
    } catch { /* quota exceeded — ignore */ }
  },

  remove(key) {
    localStorage.removeItem(`sudoku:${key}`);
  },

  // ── Offline queue ─────────────────────────────────────────────────────────

  _queue: [],

  enqueue(request) {
    // request = { method, path, body }
    this._queue.push(request);
    this.set('offlineQueue', this._queue);
  },

  loadQueue() {
    this._queue = this.get('offlineQueue') || [];
  },

  async flushQueue() {
    if (this._queue.length === 0) return;
    const pending = [...this._queue];
    this._queue = [];
    this.remove('offlineQueue');

    for (const req of pending) {
      try {
        await API._rawFetch(req.method, req.path, req.body);
      } catch {
        // Still offline — re-queue
        this.enqueue(req);
      }
    }
  },
};
