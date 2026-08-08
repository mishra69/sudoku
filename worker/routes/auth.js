// Auth routes: register, login

export async function handleAuth(path, request, env) {
  const body = await request.json().catch(() => ({}));

  if (path === '/auth/register') return register(body, env);
  if (path === '/auth/login')    return login(body, env);

  return json({ error: 'Not found' }, 404);
}

async function register({ name, pin }, env) {
  if (!name || !pin || !/^\d{4}$/.test(pin)) {
    return json({ error: 'Name and 4-digit PIN required' }, 400);
  }

  // Check name not already taken
  const existing = await env.DB.prepare('SELECT id FROM players WHERE name = ?').bind(name).first();
  if (existing) return json({ error: 'Name already taken' }, 409);

  const salt = crypto.randomUUID();
  const pinHash = await hashPin(pin, salt);

  const result = await env.DB.prepare(
    'INSERT INTO players (name, pin_hash, salt) VALUES (?, ?, ?) RETURNING id'
  ).bind(name, pinHash, salt).first();

  const token = await makeToken(result.id, env.TOKEN_SECRET);
  return json({ token, playerId: result.id, name });
}

async function login({ name, pin }, env) {
  if (!name || !pin) return json({ error: 'Name and PIN required' }, 400);

  const player = await env.DB.prepare(
    'SELECT id, pin_hash, salt FROM players WHERE name = ?'
  ).bind(name).first();

  if (!player) return json({ error: 'Player not found' }, 404);

  const hash = await hashPin(pin, player.salt);
  if (hash !== player.pin_hash) return json({ error: 'Incorrect PIN' }, 401);

  const token = await makeToken(player.id, env.TOKEN_SECRET);
  return json({ token, playerId: player.id, name });
}

// ── Helpers ───────────────────────────────────────────────────────────────

// Hash PIN using PBKDF2 (pin + salt, no external secret needed)
async function hashPin(pin, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin + salt), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100_000, hash: 'SHA-256' },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-signed token: payload.signature
export async function makeToken(playerId, secret) {
  const payload = btoa(JSON.stringify({ id: playerId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
  const sig = await hmac(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifyToken(token, secret) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = await hmac(payload, secret);
  if (expected !== sig) return null;

  const data = JSON.parse(atob(payload));
  if (data.exp < Date.now()) return null;

  return data.id;
}

async function hmac(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
