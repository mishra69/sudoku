import { handleAuth, verifyToken } from './routes/auth.js';
import { handleScores } from './routes/scores.js';
import { handleGames } from './routes/games.js';
import { handlePush, handlePushResubscribe } from './routes/push.js';
import { handlePuzzles } from './routes/puzzles.js';

// Static assets are matched before this Worker runs (see [assets] in
// wrangler.toml), so anything arriving here is an /api/* call or a 404.
// Frontend and API share an origin, so no CORS handling is needed.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (!path.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    const apiPath = path.slice(4); // strip /api prefix

    try {
      // Public routes (no auth required)
      // The service worker has no token, so endpoint rotation lands here.
      if (apiPath === '/push/resubscribe' && method === 'POST') {
        return await handlePushResubscribe(request, env);
      }

      // The VAPID *public* key is public by definition — the browser passes it
      // as applicationServerKey. Gating it behind auth just breaks subscription.
      if (apiPath === '/push/key') {
        return await handlePush(apiPath, method, request, null, env);
      }

      if (apiPath.startsWith('/auth/')) {
        return await handleAuth(apiPath, request, env);
      }

      // Protected routes — verify token
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const playerId = await verifyToken(token, env.TOKEN_SECRET);

      if (!playerId) {
        return json({ error: 'Unauthorized' }, 401);
      }

      if (apiPath === '/scores' || apiPath.startsWith('/scores?')) {
        return await handleScores(method, request, playerId, env);
      }

      if (apiPath.startsWith('/game/')) {
        return await handleGames(method, request, playerId, env);
      }

      if (apiPath === '/puzzle' || apiPath.startsWith('/puzzle?')) {
        return await handlePuzzles(method, url, playerId, env);
      }

      if (apiPath.startsWith('/push/')) {
        return await handlePush(apiPath, method, request, playerId, env);
      }

      return json({ error: 'Not found' }, 404);

    } catch (err) {
      console.error(err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
