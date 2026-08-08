// Saved game routes

export async function handleGames(method, request, playerId, env) {
  if (method === 'GET')    return loadGame(playerId, env);
  if (method === 'POST')   return saveGame(request, playerId, env);
  if (method === 'DELETE') return deleteGame(playerId, env);
  return json({ error: 'Method not allowed' }, 405);
}

async function loadGame(playerId, env) {
  const saved = await env.DB.prepare(
    'SELECT * FROM saved_games WHERE player_id = ?'
  ).bind(playerId).first();

  if (!saved) return json({ saved: null });

  // Parse JSON fields back out
  return json({
    saved: {
      ...saved,
      config: JSON.parse(saved.config),
    }
  });
}

async function saveGame(request, playerId, env) {
  const body = await request.json().catch(() => ({}));
  const {
    puzzle_initial, puzzle_solution, puzzle_current, cell_types,
    move_history, config, score_remaining, mistakes_count,
    hints_count, elapsed_seconds, started_at,
  } = body;

  if (!puzzle_initial || !puzzle_solution) {
    return json({ error: 'Missing puzzle data' }, 400);
  }

  // Upsert — one saved game per player
  await env.DB.prepare(`
    INSERT INTO saved_games
      (player_id, puzzle_initial, puzzle_solution, puzzle_current, cell_types,
       move_history, config, score_remaining, mistakes_count, hints_count,
       elapsed_seconds, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(player_id) DO UPDATE SET
      puzzle_initial   = excluded.puzzle_initial,
      puzzle_solution  = excluded.puzzle_solution,
      puzzle_current   = excluded.puzzle_current,
      cell_types       = excluded.cell_types,
      move_history     = excluded.move_history,
      config           = excluded.config,
      score_remaining  = excluded.score_remaining,
      mistakes_count   = excluded.mistakes_count,
      hints_count      = excluded.hints_count,
      elapsed_seconds  = excluded.elapsed_seconds,
      started_at       = excluded.started_at,
      updated_at       = datetime('now')
  `).bind(
    playerId,
    puzzle_initial,
    puzzle_solution,
    puzzle_current,
    cell_types,
    move_history,
    JSON.stringify(config),
    score_remaining ?? 0,
    mistakes_count  ?? 0,
    hints_count     ?? 0,
    elapsed_seconds ?? 0,
    started_at ?? new Date().toISOString(),
  ).run();

  return json({ ok: true });
}

async function deleteGame(playerId, env) {
  await env.DB.prepare('DELETE FROM saved_games WHERE player_id = ?').bind(playerId).run();
  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
