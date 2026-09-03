// Telemetry for the hard-move detector.
//
// Batched from the client at the end of a game rather than per event: the
// volume is tiny (single figures per game) and a game shouldn't spend requests
// on instrumentation while it's being played.

const MAX_EVENTS = 40;   // a game can't produce this many; the cap is for safety

export async function handleTelemetry(method, request, playerId, env) {
  if (method !== 'POST') return json({ error: 'Not found' }, 404);

  const body = await request.json().catch(() => ({}));
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  if (!events.length) return json({ ok: true, stored: 0 });

  const stmt = env.DB.prepare(
    `INSERT INTO praise_events
       (player_id, difficulty, puzzle_id, shown, message, hardness, isolation,
        peers_filled, board_filled, candidates, available, empty_cells,
        think_ms, taps, move_index, bar)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  await env.DB.batch(events.map(e => stmt.bind(
    playerId,
    String(e.difficulty || ''),
    e.puzzleId ?? null,
    e.shown ? 1 : 0,
    e.message ?? null,
    num(e.hardness), num(e.isolation),
    int(e.peersFilled), num(e.boardFilled), int(e.candidates),
    int(e.available), int(e.empty),
    int(e.thinkMs), int(e.taps), int(e.moveIndex), num(e.bar)
  )));

  return json({ ok: true, stored: events.length });
}

// Telemetry must never be able to fail a request with bad input, so anything
// unparseable becomes null rather than throwing.
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function int(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
