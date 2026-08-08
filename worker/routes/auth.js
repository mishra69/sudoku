// Auth routes: Google sign-in.
//
// The client sends the ID token ("credential") that Google Identity Services
// hands it. We verify that JWT against Google's public keys, then mint our own
// short session token. Google's token is never stored or reused.

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

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
    claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
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

// ── Google ID token verification ──────────────────────────────────────────

async function verifyGoogleIdToken(credential, clientId) {
  const parts = credential.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');
  const [rawHeader, rawPayload, rawSig] = parts;

  const header = JSON.parse(b64urlToString(rawHeader));
  const claims = JSON.parse(b64urlToString(rawPayload));

  if (header.alg !== 'RS256') throw new Error('unexpected alg ' + header.alg);

  // Google rotates these keys; the edge cache keeps it to roughly one fetch
  // per hour per colo rather than one per sign-in.
  const jwks = await fetch(GOOGLE_JWKS, { cf: { cacheTtl: 3600, cacheEverything: true } })
    .then(r => r.json());
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(rawSig),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
  );
  if (!valid) throw new Error('bad signature');

  // A valid signature only proves Google issued it — these checks prove it was
  // issued for THIS app and is still current.
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== clientId) throw new Error('bad audience');
  if (!claims.sub) throw new Error('no subject');
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) throw new Error('expired');
  if (claims.iat && claims.iat > now + 300) throw new Error('issued in the future');

  return claims;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
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
