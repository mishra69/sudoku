import { handleAuth, verifyToken, makeToken } from './routes/auth.js';
import { handleScores } from './routes/scores.js';
import { handleGames } from './routes/games.js';
import { handlePush, handlePushResubscribe } from './routes/push.js';
import { handlePuzzles } from './routes/puzzles.js';
import { handleTelemetry } from './routes/telemetry.js';
import { runReminders, handleReminderClicked, handleReminderAdmin } from './routes/reminders.js';
import { touch, markPlayed } from './lib/activity.js';

// Static assets are matched before this Worker runs (see [assets] in
// wrangler.toml), so anything arriving here is an /api/* call or a 404.
// Frontend and API share an origin, so no CORS handling is needed.
export default {
  // Daily re-engagement job (schedule in wrangler.toml [triggers]).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, 'cron'));
  },

  async fetch(request, env, ctx) {
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

      // Likewise a tap on a reminder: reported by the service worker, and the
      // player tapping may well be one whose session has lapsed.
      if (apiPath === '/push/clicked' && method === 'POST') {
        return await handleReminderClicked(request, env);
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
      const session = await verifyToken(token, env.TOKEN_SECRET);

      if (!session) {
        return json({ error: 'Unauthorized' }, 401);
      }

      // Looking at the reminder stats is not playing, and must not credit the
      // admin's own test reminder as a return before it's even tapped.
      const isAdminPath = apiPath.startsWith('/push/reminders/');
      if (!isAdminPath) ctx.waitUntil(touch(env, session.id).catch(e => console.error('[touch]', e)));

      const res = await route(apiPath, method, request, url, session.id, env);

      // Saving or finishing a game is the strongest sign a reminder worked.
      const played = method === 'POST' && res.ok && (apiPath === '/scores' || apiPath === '/game/save');
      if (played) ctx.waitUntil(markPlayed(env, session.id).catch(e => console.error('[played]', e)));
      // Sliding session: past half-life, piggyback a fresh token on whatever
      // response is going out anyway. The client swaps it in silently.
      if (session.renew) {
        const fresh = new Response(res.body, res);
        fresh.headers.set('X-Session-Token', await makeToken(session.id, env.TOKEN_SECRET));
        return fresh;
      }
      return res;

    } catch (err) {
      console.error(err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
};

async function route(apiPath, method, request, url, playerId, env) {
  // Sent once when the app opens signed in. The point is the side effects:
  // activity is recorded (so a return from a reminder is counted even if they
  // don't play), and a dead session is noticed straight away.
  if (apiPath === '/ping') return json({ ok: true });

  if (apiPath.startsWith('/push/reminders/')) {
    return await handleReminderAdmin(apiPath.slice(5), method, playerId, env);
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

  if (apiPath === '/telemetry/praise') {
    return await handleTelemetry(method, request, playerId, env);
  }

  if (apiPath.startsWith('/push/')) {
    return await handlePush(apiPath, method, request, playerId, env);
  }

  return json({ error: 'Not found' }, 404);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
