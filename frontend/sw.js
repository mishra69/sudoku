// Stamped by deploy.sh. Deriving the cache name from it means every deploy
// gets a fresh cache automatically — no more hand-bumping a version number
// and shipping stale CSS when you forget.
const VERSION = '20260808_1111';
const CACHE = 'sudoku-' + VERSION;
const SHELL = [
  // '/' only: Workers Static Assets 307-redirects /index.html to /, and the
  // Cache API refuses to store a redirected response.
  '/',
  '/css/styles.css',
  '/js/config.js',
  '/js/storage.js',
  '/js/puzzle.js',
  '/js/sound.js',
  '/js/game.js',
  '/js/timer.js',
  '/js/ui.js',
  '/js/animations.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/app.js',
  '/js/pwa-install.js',
  '/js/vendor/sudoku.js',
  '/manifest.json',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // Cache each file independently: with addAll() a single 404 rejects the
      // whole install and the app silently loses offline support.
      .then(c => Promise.all(
        SHELL.map(url => c.add(url).catch(err => {
          console.warn('[sw] failed to precache', url, err);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never touch the cache for non-GET or cross-origin requests.
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // Network-only for API calls, with a JSON error the client can parse offline.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
    );
    return;
  }

  // Network-first for navigations so a deploy is picked up on the next launch;
  // falls back to the cached shell when offline.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put('/', clone));
          }
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Version probes (?_v=) must reach the network — otherwise the app compares
  // the cache against itself and can never notice it's running an old build.
  if (url.searchParams.has('_v')) {
    e.respondWith(fetch(request));
    return;
  }

  // Cache-first for static assets, refreshing the cache in the background.
  e.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      }).catch(err => {
        // Offline with nothing cached: let the request fail as it normally would.
        if (cached) return cached;
        throw err;
      });
      return cached || network;
    })
  );
});
