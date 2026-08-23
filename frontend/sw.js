// Stamped by deploy.sh. Deriving the cache name from it means every deploy
// gets a fresh cache automatically — no more hand-bumping a version number
// and shipping stale CSS when you forget.
const VERSION = '20260823_1208';
const CACHE = 'sudoku-' + VERSION;
const SHELL = [
  // '/' only: Workers Static Assets 307-redirects /index.html to /, and the
  // Cache API refuses to store a redirected response.
  '/',
  '/css/styles.css',
  '/js/config.js',
  '/js/storage.js',
  '/js/puzzle-cache.js',
  '/js/puzzle.js',
  '/js/sound.js',
  '/js/game.js',
  '/js/timer.js',
  '/js/wakelock.js',
  '/js/vendor/webpush-edge/client.js',
  '/js/vendor/webpush-edge/sw.js',
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

// ── Web Push ───────────────────────────────────────────────────────────────
// Ported from webpush-edge/src/sw.js (v1.0.0). Inlined rather than imported:
// this is a classic service worker, and the package's half is an ES module.
//
// A push handler is not optional on iOS. Safari 18.4+ advertises Declarative
// Web Push rendering straight from the payload with no service worker, but it
// was found not to display on-device.

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = {}; }
  // Accept the declarative shape ({ notification: {...} }) or a flat object.
  const n = data.notification || data;
  e.waitUntil(self.registration.showNotification(n.title || 'Sudoku', {
    body: n.body || '',
    icon: n.icon || '/icons/icon-192.png',
    badge: n.badge || '/icons/icon-192.png',
    tag: n.tag || 'sudoku',
    data: { url: n.navigate || n.url || '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        if ('navigate' in c && c.url !== url) await c.navigate(url).catch(() => {});
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});

// Push services rotate endpoints. Without this the subscription silently dies
// and notifications just stop, with nothing user-visible to explain it.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const { key } = await (await fetch('/api/push/key')).json();
      if (!key) return;
      const padding = '='.repeat((4 - (key.length % 4)) % 4);
      const b64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(b64);
      const appKey = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) appKey[i] = raw.charCodeAt(i);
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: appKey,
      });
      // Unauthenticated: a service worker has no access token. The endpoint is
      // re-associated on the next page load, when the client re-subscribes.
      await fetch('/api/push/resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint: e.oldSubscription && e.oldSubscription.endpoint }),
      });
    } catch (err) { /* the page re-subscribes on next open */ }
  })());
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
