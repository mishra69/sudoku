// Session telemetry. The client buffers events on the device and sends them in
// batches (on open, on going to the background), so an abandoned game or a
// logged-out session still reaches here eventually.

const MAX_EVENTS = 200;

export async function handleEvents(method, request, playerId, env) {
  if (method !== 'POST') return json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => ({}));
  const events = (Array.isArray(body.events) ? body.events : [])
    .slice(0, MAX_EVENTS)
    .filter(e => e && typeof e.type === 'string' && e.type.length <= 32);
  if (!events.length) return json({ ok: true, stored: 0 });

  const stmt = env.DB.prepare(
    'INSERT INTO events (player_id, at, tz, type, data) VALUES (?, ?, ?, ?, ?)'
  );
  const stmts = events.map(e => stmt.bind(
    playerId,
    validTime(e.at) || new Date().toISOString(),
    str(e.tz, 64),
    e.type,
    e.data === undefined ? null : JSON.stringify(e.data).slice(0, 2000),
  ));

  const tz = str([...events].reverse().find(e => e.tz)?.tz, 64);
  if (tz) stmts.push(env.DB.prepare('UPDATE players SET tz = ? WHERE id = ?').bind(tz, playerId));

  await env.DB.batch(stmts);
  return json({ ok: true, stored: events.length });
}

function validTime(t) {
  if (typeof t !== 'string') return null;
  const d = new Date(t);
  return isNaN(d) ? null : d.toISOString();
}

function str(v, max) {
  return typeof v === 'string' && v ? v.slice(0, max) : null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
