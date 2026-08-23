// Serve pre-generated puzzles from the shared pool.
//
// Only the hardest level uses this today: an `insane` puzzle costs a median 71
// seconds of CPU to generate, so it can't be made in a browser. The easier
// levels are still generated client-side in about 100ms.

export async function handlePuzzles(method, url, playerId, env) {
  if (method !== 'GET') return json({ error: 'Not found' }, 404);

  const difficulty = url.searchParams.get('difficulty');
  if (!difficulty) return json({ error: 'difficulty required' }, 400);

  // Least-served first, so the pool spreads out instead of everyone drawing the
  // same puzzle. The random tiebreak stops two players who ask at the same
  // moment getting an identical grid.
  const row = await env.DB.prepare(
    `SELECT id, puzzle, solution, givens
       FROM puzzles
      WHERE difficulty = ?
      ORDER BY times_served ASC, RANDOM()
      LIMIT 1`
  ).bind(difficulty).first();

  if (!row) return json({ error: `no puzzles available for "${difficulty}"` }, 404);

  // times_served is not just a statistic — the ordering above depends on it.
  // Without this every player would be handed the same puzzle forever.
  await env.DB.prepare(
    'UPDATE puzzles SET times_served = times_served + 1 WHERE id = ?'
  ).bind(row.id).run();

  return json({
    id: row.id,
    initial: row.puzzle,
    solution: row.solution,
    givens: row.givens,
    difficulty,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
