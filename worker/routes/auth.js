// Auth routes: Google sign-in.
//
// The client sends the ID token ("credential") that Google Identity Services
// hands it. We verify that JWT, then mint our own session token. Google's token
// is never stored or reused. Verification itself lives in lib/oidc.js — it is
// provider-agnostic and has nothing app-specific in it.

import { verifyIdToken, GOOGLE } from '../lib/oidc.js';
import { markReturned } from '../lib/activity.js';

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

  // Sign-in moves last_seen_at itself, so the hourly throttle in touch() won't
  // fire afterwards — credit any recent reminder here instead. A lapsed player
  // tapping a reminder often lands on sign-in first.
  await markReturned(env, player.id);

  const token = await makeToken(player.id, env.TOKEN_SECRET);
  return json({ token, playerId: player.id, name: player.name, picture: player.picture });
}

// ── Session tokens ────────────────────────────────────────────────────────

// HMAC-signed token: payload.signature
// Long, because the moment that matters most is a lapsed player coming back
// on their own — that should land them in their game, not on a sign-in screen.
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
// Tokens are reissued once they're past half-life, so anyone who opens the app
// at least every three months is never signed out.
const RENEW_BELOW_MS = TOKEN_TTL_MS / 2;

export async function makeToken(playerId, secret) {
  const payload = btoa(JSON.stringify({ id: playerId, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = await hmac(payload, secret);
  return `${payload}.${sig}`;
}

// Returns { id, renew } — renew is true when the caller should hand back a
// fresh token — or null if the token is missing, forged, malformed or expired.
export async function verifyToken(token, secret) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expected = await hmac(payload, secret);
  if (expected !== sig) return null;

  let data;
  try { data = JSON.parse(atob(payload)); } catch { return null; }
  if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;

  return { id: data.id, renew: data.exp - Date.now() < RENEW_BELOW_MS };
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
