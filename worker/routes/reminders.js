// Re-engagement reminders: a daily job that nudges lapsed players, and the
// numbers that say whether nudging them does anything.
//
// The measure that matters is lift: of reminded players, how many came back,
// versus held-out players who were equally lapsed and got nothing. Delivery
// and taps are recorded too, but a tap is not a return and a return is not
// a game — each step is tracked separately so you can see where people drop.

import { pusher } from './push.js';

const IDLE_DAYS = 3;        // remind after this long without signed-in activity
const REMIND_HOUR = 15;     // local hour to send at; her games mostly ended 3-6pm
// Share of lapses held out as a baseline. Zero while there are two players:
// holding one out just means she never gets a reminder. With n = 1 the
// comparison is before vs after, read off the activity timeline.
const HOLDOUT = 0;
const MAX_PER_RUN = 25;     // keeps a run inside the Worker's subrequest budget; the rest go tomorrow
const WINDOW_DAYS = 3;      // "came back" means within this long of the reminder

const MESSAGES = {
  resume: { title: 'Sudoku', body: 'Your puzzle is right where you left it. Pick it back up?' },
  fresh:  { title: 'Sudoku', body: 'A fresh puzzle is waiting for you.' },
};

// ── The job ────────────────────────────────────────────────────────────────

// The local hour for a player now. The zone comes from their device, so this
// follows them when they travel; unknown zones fall back to DEFAULT_TZ.
function localHour(tz, fallback) {
  for (const zone of [tz, fallback, 'UTC']) {
    if (!zone) continue;
    try {
      return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    } catch { /* bad zone name: try the next */ }
  }
  return new Date().getUTCHours();
}

// Runs hourly. `anyHour` (the manual button) skips the local-time check.
export async function runReminders(env, trigger = 'cron', { anyHour = false } = {}) {
  const run = { eligible: 0, reminded: 0, held_out: 0, devices_sent: 0, devices_failed: 0, pruned: 0, error: null };
  try {
    // Lapsed, reachable, and not already counted for this lapse. A reminder
    // (or a hold-out) after their last activity means this lapse is handled:
    // one per absence, never a daily drip.
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.tz,
              julianday('now') - julianday(p.last_seen_at) AS idle_days,
              EXISTS (SELECT 1 FROM saved_games g WHERE g.player_id = p.id) AS has_saved
       FROM players p
       WHERE p.last_seen_at < datetime('now', ?)
         AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.player_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM reminders r
                         WHERE r.player_id = p.id AND r.test = 0 AND r.sent_at > p.last_seen_at)
       ORDER BY p.last_seen_at
       LIMIT ?`
    ).bind(`-${IDLE_DAYS} days`, MAX_PER_RUN).all();
    const due = anyHour ? results : results.filter(p => localHour(p.tz, env.DEFAULT_TZ) === REMIND_HOUR);
    // An hourly run where it's 3pm for nobody isn't worth a row in the log.
    if (!due.length && !anyHour) return run;
    run.eligible = due.length;

    for (const p of due) {
      const heldOut = Math.random() < HOLDOUT;
      const r = await remind(env, p.id, { idleDays: p.idle_days, variant: p.has_saved ? 'resume' : 'fresh', heldOut });
      if (heldOut) run.held_out++; else run.reminded++;
      run.devices_sent += r.devices_sent;
      run.devices_failed += r.devices_failed;
      run.pruned += r.pruned;
    }
  } catch (e) {
    run.error = String(e?.message || e).slice(0, 500);
    console.error('[reminders] run failed', e);
  }

  await env.DB.prepare(
    `INSERT INTO reminder_runs (trigger, eligible, reminded, held_out, devices_sent, devices_failed, pruned, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(trigger, run.eligible, run.reminded, run.held_out, run.devices_sent, run.devices_failed, run.pruned, run.error).run();
  return run;
}

// Record the lapse first, then send: if the send throws, the row still exists,
// so the player isn't retried every day and the failure shows in the stats.
async function remind(env, playerId, { idleDays, variant, heldOut, test = false }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO reminders (id, player_id, idle_days, variant, held_out, test) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, playerId, idleDays, variant, heldOut ? 1 : 0, test ? 1 : 0).run();

  const out = { id, devices_sent: 0, devices_failed: 0, pruned: 0 };
  if (heldOut) return out;

  const msg = MESSAGES[variant];
  // One player's failure (even a config error that throws synchronously) is
  // recorded on their row; it must not stop the rest of the run.
  let result;
  try {
    result = await pusher(env).send(playerId, {
      ...msg,
      navigate: '/',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'sudoku-reminder',
      reminder: id,            // the service worker reports a tap against this
    });
  } catch (e) {
    console.error('[reminders] send failed', e);
    result = { sent: 0, failed: 1, pruned: 0 };
  }

  out.devices_sent = result.sent;
  out.devices_failed = result.failed;
  out.pruned = result.pruned;
  await env.DB.prepare(
    `UPDATE reminders SET devices_sent = ?, devices_failed = ?, pruned = ? WHERE id = ?`
  ).bind(out.devices_sent, out.devices_failed, out.pruned, id).run();
  return out;
}

// ── Tap tracking (public) ──────────────────────────────────────────────────

// Called by the service worker, which has no session token — and the player
// tapping a reminder is exactly the one whose session may have expired. The id
// is random and only ever sits in that device's notification; all it can do is
// mark that one reminder tapped.
export async function handleReminderClicked(request, env) {
  const { id } = await request.json().catch(() => ({}));
  if (typeof id !== 'string' || id.length > 64) return json({ ok: false }, 400);
  await env.DB.prepare(
    `UPDATE reminders SET clicked_at = datetime('now') WHERE id = ? AND clicked_at IS NULL`
  ).bind(id).run();
  return json({ ok: true });
}

// ── Admin: stats and manual triggers ───────────────────────────────────────

export async function handleReminderAdmin(path, method, playerId, env) {
  if (!(await isAdmin(env, playerId))) return json({ error: 'Forbidden' }, 403);

  if (path === '/reminders/stats' && method === 'GET') return json(await stats(env));

  // Run the real job now, exactly as the cron would.
  if (path === '/reminders/run' && method === 'POST') {
    return json({ ok: true, run: await runReminders(env, 'manual', { anyHour: true }) });
  }

  // A real reminder to your own devices, marked test so it stays out of the
  // numbers. Tap it and the row should show tapped/returned within seconds.
  if (path === '/reminders/test' && method === 'POST') {
    const saved = await env.DB.prepare('SELECT 1 FROM saved_games WHERE player_id = ?').bind(playerId).first();
    const r = await remind(env, playerId, { idleDays: 0, variant: saved ? 'resume' : 'fresh', heldOut: false, test: true });
    // A test sits on top of fresh activity, so the throttle in touch() would
    // never credit it; clear last_seen so the next request counts as a return.
    await env.DB.prepare(`UPDATE players SET last_seen_at = datetime('now', '-2 hours') WHERE id = ?`).bind(playerId).run();
    return json({ ok: r.devices_sent > 0, ...r });
  }

  return json({ error: 'Not found' }, 404);
}

async function isAdmin(env, playerId) {
  const admins = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!admins.length) return false;
  const p = await env.DB.prepare('SELECT email FROM players WHERE id = ?').bind(playerId).first();
  return !!p?.email && admins.includes(p.email.toLowerCase());
}

async function stats(env) {
  const win = `+${WINDOW_DAYS} days`;
  // Only reminders old enough to have had the full window count toward rates,
  // otherwise yesterday's batch drags every rate down until it matures.
  const groups = await env.DB.prepare(
    `SELECT CASE WHEN held_out = 1 THEN 'held_out' ELSE 'reminded' END AS grp,
            COUNT(*) AS n,
            SUM(devices_sent > 0) AS delivered,
            SUM(clicked_at IS NOT NULL) AS tapped,
            SUM(returned_at IS NOT NULL AND returned_at <= datetime(sent_at, ?)) AS returned,
            SUM(played_at IS NOT NULL AND played_at <= datetime(sent_at, ?)) AS played
     FROM reminders
     WHERE test = 0 AND sent_at <= datetime('now', ?)
     GROUP BY grp`
  ).bind(win, win, `-${WINDOW_DAYS} days`).all();

  const variants = await env.DB.prepare(
    `SELECT variant, COUNT(*) AS n,
            SUM(clicked_at IS NOT NULL) AS tapped,
            SUM(returned_at IS NOT NULL AND returned_at <= datetime(sent_at, ?)) AS returned,
            SUM(played_at IS NOT NULL AND played_at <= datetime(sent_at, ?)) AS played
     FROM reminders
     WHERE test = 0 AND held_out = 0 AND sent_at <= datetime('now', ?)
     GROUP BY variant`
  ).bind(win, win, `-${WINDOW_DAYS} days`).all();

  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM reminders WHERE test = 0 AND sent_at > datetime('now', ?)`
  ).bind(`-${WINDOW_DAYS} days`).first();

  const runs = await env.DB.prepare(
    `SELECT * FROM reminder_runs ORDER BY id DESC LIMIT 14`
  ).all();

  const recent = await env.DB.prepare(
    `SELECT r.id, p.name, r.sent_at, r.idle_days, r.variant, r.held_out, r.test,
            r.devices_sent, r.devices_failed, r.pruned, r.clicked_at, r.returned_at, r.played_at
     FROM reminders r JOIN players p ON p.id = r.player_id
     ORDER BY r.sent_at DESC LIMIT 30`
  ).all();

  // Per-player overview and the raw activity timeline: with one or two
  // players, reading what happened beats any rate.
  const players = await env.DB.prepare(
    `SELECT p.id, p.name, p.tz, p.last_seen_at,
            (SELECT COUNT(*) FROM push_subscriptions s WHERE s.player_id = p.id) AS devices,
            (SELECT MAX(completed_at) FROM scores s WHERE s.player_id = p.id AND s.completed = 1) AS last_finished,
            (SELECT updated_at FROM saved_games g WHERE g.player_id = p.id) AS saved_game_at,
            (SELECT data FROM events e WHERE e.player_id = p.id AND e.type = 'app_open' ORDER BY e.at DESC LIMIT 1) AS last_open
     FROM players p ORDER BY p.last_seen_at DESC`
  ).all();

  const events = await env.DB.prepare(
    `SELECT e.player_id, e.at, e.tz, e.type, e.data FROM events e
     WHERE e.at > datetime('now', '-60 days')
     ORDER BY e.at DESC LIMIT 1500`
  ).all();

  const reachable = await env.DB.prepare(
    `SELECT COUNT(DISTINCT player_id) AS n FROM push_subscriptions`
  ).first();

  return {
    config: { idle_days: IDLE_DAYS, holdout: HOLDOUT, window_days: WINDOW_DAYS, max_per_run: MAX_PER_RUN, remind_hour: REMIND_HOUR },
    players: players.results,
    events: events.results,
    reachable_players: reachable?.n || 0,
    pending: pending?.n || 0,
    groups: groups.results,
    variants: variants.results,
    runs: runs.results,
    recent: recent.results,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
