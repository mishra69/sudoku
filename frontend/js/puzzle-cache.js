// A small on-device buffer of pre-generated puzzles.
//
// Pooled difficulties are fetched, which would otherwise make them unplayable
// offline. Keeping a few in reserve means the hardest level still works on a
// plane — and it's a better answer than substituting an easier puzzle under a
// harder label.
//
// Puzzles are ~170 bytes each, so localStorage is ample and avoids IndexedDB's
// async ceremony for something this small.

const PuzzleCache = {
  TARGET: 3,          // per pooled difficulty
  _refilling: {},     // difficulty -> promise, so parallel calls don't double-fetch

  _key(difficulty) { return `puzzleCache:${difficulty}`; },

  list(difficulty) {
    const v = Storage.get(this._key(difficulty));
    return Array.isArray(v) ? v : [];
  },

  count(difficulty) { return this.list(difficulty).length; },

  // Remove and return the next puzzle, or null when the buffer is empty.
  take(difficulty) {
    const list = this.list(difficulty);
    const next = list.shift() || null;
    Storage.set(this._key(difficulty), list);
    return next;
  },

  add(difficulty, puzzles) {
    if (!puzzles || !puzzles.length) return;
    const list = this.list(difficulty);
    const seen = new Set(list.map(p => p.id));
    for (const p of puzzles) if (!seen.has(p.id)) list.push(p);
    Storage.set(this._key(difficulty), list);
  },

  // Top the buffer back up. Safe to call often: it no-ops when full or offline,
  // and concurrent calls share one request.
  async refill(difficulty) {
    if (!navigator.onLine) return;
    const need = this.TARGET - this.count(difficulty);
    if (need <= 0) return;
    if (this._refilling[difficulty]) return this._refilling[difficulty];

    this._refilling[difficulty] = (async () => {
      try {
        const data = await API.getPuzzles(difficulty, need);
        this.add(difficulty, (data && data.puzzles) || []);
      } catch (e) {
        // Offline, unauthenticated, or an empty pool — the buffer just stays
        // where it is and the next attempt tries again.
      } finally {
        delete this._refilling[difficulty];
      }
    })();
    return this._refilling[difficulty];
  },

  // Fill every pooled difficulty. Called at boot and on reconnect.
  refillAll() {
    return Promise.all(
      Object.entries(CONFIG.DIFFICULTIES)
        .filter(([, spec]) => spec.pooled)
        .map(([key]) => this.refill(key))
    );
  },
};
