// Player activity, and crediting reminders when a player comes back.
//
// players.last_seen_at used to move only on sign-in, which with 30-day tokens
// meant "last signed in", not "last played". It now moves on any signed-in
// request, at most once an hour so a game's autosaves don't each cost a write.

// Credit only reminders recent enough to plausibly be the cause.
const ATTRIBUTION = '-7 days';

export async function touch(env, playerId) {
  const moved = await env.DB.prepare(
    `UPDATE players SET last_seen_at = datetime('now')
     WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-1 hour'))
     RETURNING id`
  ).bind(playerId).first();
  // A reminder only goes to someone idle for days, so the first request after
  // one always gets past the hourly throttle — no need to check every time.
  if (moved) await markReturned(env, playerId);
}

export async function markReturned(env, playerId) {
  await env.DB.prepare(
    `UPDATE reminders SET returned_at = datetime('now')
     WHERE player_id = ? AND returned_at IS NULL AND sent_at > datetime('now', ?)`
  ).bind(playerId, ATTRIBUTION).run();
}

export async function markPlayed(env, playerId) {
  await env.DB.prepare(
    `UPDATE reminders SET played_at = datetime('now'),
       returned_at = COALESCE(returned_at, datetime('now'))
     WHERE player_id = ? AND played_at IS NULL AND sent_at > datetime('now', ?)`
  ).bind(playerId, ATTRIBUTION).run();
}
