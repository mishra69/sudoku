// Auth routes: Google sign-in.
//
// The client sends the ID token ("credential") that Google Identity Services
// hands it. We verify that JWT, then mint our own session token. Google's token
// is never stored or reused. Verification itself lives in lib/oidc.js — it is
// provider-agnostic and has nothing app-specific in it.

import { verifyIdToken, GOOGLE } from '../lib/oidc.js';

export async function handleAuth(path, request, env) {
  // The client needs the OAuth client id to initialise Google's SDK. It isn't
  // secret, but serving it keeps wrangler.toml the single source of truth.
  if (path === '/auth/config') {
    return json({ clientId: env.GOOGLE_CLIENT_ID || null });
  }

  if (path === '/auth/google') {
    const body = await request.json().catch(() => ({}));
    return googleSignIn(body, env);
  }

  return json({ error: 'Not found' }, 404);
}

async function googleSignIn({ credential }, env) {
  if (!credential) return json({ error: 'Missing credential' }, 400);
  if (!env.GOOGLE_CLIENT_ID) {
    return json({ error: 'Server is missing GOOGLE_CLIENT_ID' }, 500);
  }

  let claims;
  try {
    claims = await verifyIdToken(credential, { ...GOOGLE, audience: env.GOOGLE_CLIENT_ID });
  } catch (e) {
    // Don't leak which check failed — it's all "we don't trust this token".
    console.warn('google id token rejected:', e.message);
    return json({ error: 'Sign-in failed' }, 401);
  }

  // Google only guarantees `sub` is stable. Emails can be changed or reused,
  // so they're stored for display but never used as an identity key.
  const player = await env.DB.prepare(`
    INSERT INTO players (google_sub, email, name, picture)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET
      email        = excluded.email,
      name         = excluded.name,
      picture      = excluded.picture,
      last_seen_at = datetime('now')
    RETURNING id, name, picture
  `).bind(
    claims.sub,
    claims.email || null,
    claims.name || claims.email || 'Player',
    claims.picture || null
  ).first();

  const token = await makeToken(player.id, env.TOKEN_SECRET);
  return json({ token, playerId: player.id, name: player.name, picture: player.picture });
}

// ── Session tokens ────────────────────────────────────────────────────────

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
