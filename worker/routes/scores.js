// Score routes

export async function handleScores(method, request, playerId, env) {
  if (method === 'GET')  return getScores(request, env);
  if (method === 'POST') return saveScore(request, playerId, env);
  return json({ error: 'Method not allowed' }, 405);
}

async function getScores(request, env) {
  const url = new URL(request.url);
  const difficulty = url.searchParams.get('difficulty');

  let query = `
    SELECT s.*, p.name as player_name
    FROM scores s
    JOIN players p ON p.id = s.player_id
    WHERE s.completed = 1
  `;
  const params = [];

  if (difficulty) {
    query += ' AND s.difficulty = ?';
    params.push(difficulty);
  }

  query += ' ORDER BY s.final_score DESC LIMIT 100';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return json({ scores: results });
}

async function saveScore(request, playerId, env) {
  const body = await request.json().catch(() => ({}));
  const {
    difficulty, final_score, time_seconds, mistakes, hints_used,
    config_mistakes_mode, config_hints_mode, config_timer_pressure, completed
  } = body;

  if (!difficulty || final_score === undefined) {
    return json({ error: 'Missing required fields' }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO scores
      (player_id, difficulty, final_score, time_seconds, mistakes, hints_used,
       config_mistakes_mode, config_hints_mode, config_timer_pressure, completed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    playerId, difficulty, final_score, time_seconds ?? 0, mistakes ?? 0,
    hints_used ?? 0, config_mistakes_mode ?? 'unlimited', config_hints_mode ?? 'unlimited',
    config_timer_pressure ?? 0, completed ?? 0
  ).run();

  return json({ ok: true }, 201);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
