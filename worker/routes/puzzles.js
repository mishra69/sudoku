// Serve pre-generated puzzles from the shared pool.
//
// Only the hardest level uses this today: an `insane` puzzle costs a median 71
// seconds of CPU to generate, so it can't be made in a browser. The easier
// levels are still generated client-side in about 100ms.

export async function handlePuzzles(method, url, playerId, env) {
  if (method !== 'GET') return json({ error: 'Not found' }, 404);

  const difficulty = url.searchParams.get('difficulty');
  if (!difficulty) return json({ error: 'difficulty required' }, 400);

  // Clients prefetch a small buffer so the level still works offline, so this
  // serves a batch. Capped: one request shouldn't be able to reserve the pool.
  const count = Math.min(Math.max(parseInt(url.searchParams.get('count') || '1', 10) || 1, 1), 5);

  // Least-served first, so the pool spreads out instead of everyone drawing the
  // same puzzle. The random tiebreak stops two players who ask at the same
  // moment getting identical grids.
  const { results } = await env.DB.prepare(
    `SELECT id, puzzle, solution, givens
       FROM puzzles
      WHERE difficulty = ?
      ORDER BY times_served ASC, RANDOM()
      LIMIT ?`
  ).bind(difficulty, count).all();

  if (!results || results.length === 0) {
    return json({ error: `no puzzles available for "${difficulty}"` }, 404);
  }

  // times_served drives the ordering above — it is rotation, not a statistic.
  // A prefetched puzzle counts as served even if it is never played: it has
  // been handed to a device, and handing the same grid to someone else would
  // be worse than retiring it early. How many people actually *attempted* a
  // puzzle is a separate counter, recorded on first save.
  await env.DB.batch(results.map(r =>
    env.DB.prepare('UPDATE puzzles SET times_served = times_served + 1 WHERE id = ?').bind(r.id)
  ));

  return json({
    difficulty,
    puzzles: results.map(r => ({
      id: r.id, initial: r.puzzle, solution: r.solution, givens: r.givens, difficulty,
    })),
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
