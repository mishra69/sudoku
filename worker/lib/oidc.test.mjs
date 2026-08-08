// Unit tests for worker/lib/oidc.js — we mint our own keypair and JWKS, so the
// happy path is exercised for real, not just the rejection paths.
import { verifyIdToken } from './oidc.js';

const enc = new TextEncoder();
const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']
);
const jwk = await crypto.subtle.exportKey('jwk', publicKey);
const KID = 'test-key-1';
const JWKS = { keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] };

// Stub fetch so the module resolves our key set instead of a real provider.
const JWKS_URL = 'https://example.test/certs';
globalThis.fetch = async (url) => {
  if (String(url) === JWKS_URL) return new Response(JSON.stringify(JWKS));
  throw new Error('unexpected fetch: ' + url);
};

const ISS = 'https://issuer.test';
const AUD = 'my-client-id';
const now = () => Math.floor(Date.now() / 1000);

async function mint(claims = {}, { alg = 'RS256', kid = KID, tamper = false } = {}) {
  const header = b64url(JSON.stringify({ alg, kid }));
  const payload = b64url(JSON.stringify({
    iss: ISS, aud: AUD, sub: 'user-123', exp: now() + 600, iat: now(), ...claims,
  }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${header}.${payload}`));
  let s = b64url(sig);
  if (tamper) s = s.slice(0, -4) + (s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  return `${header}.${payload}.${s}`;
}

const opts = { jwksUrl: JWKS_URL, issuers: [ISS], audience: AUD };
let pass = 0, fail = 0;

async function ok(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name} — ${e.message}`); fail++; }
}
async function rejects(name, token, expectMsg, o = opts) {
  try {
    await verifyIdToken(token, o);
    console.log(`  ✗ ${name} — ACCEPTED a token it must reject`); fail++;
  } catch (e) {
    if (expectMsg && !e.message.includes(expectMsg)) {
      console.log(`  ✗ ${name} — rejected for wrong reason: ${e.message}`); fail++;
    } else { console.log(`  ✓ ${name} (${e.message})`); pass++; }
  }
}

console.log('accepts:');
await ok('a valid token, returning its claims', async () => {
  const claims = await verifyIdToken(await mint(), opts);
  if (claims.sub !== 'user-123') throw new Error('wrong sub: ' + claims.sub);
  if (claims.aud !== AUD) throw new Error('wrong aud');
});
await ok('an issuer listed among several accepted ones', async () => {
  await verifyIdToken(await mint(), { ...opts, issuers: ['https://other.test', ISS] });
});

console.log('rejects:');
// The one that matters most: a real, correctly-signed token for a DIFFERENT app.
await rejects('a valid token minted for another audience', await mint({ aud: 'someone-elses-client' }), 'bad audience');
await rejects('a token from an unexpected issuer', await mint({ iss: 'https://evil.test' }), 'bad issuer');
await rejects('an expired token', await mint({ exp: now() - 10 }), 'expired');
await rejects('a token issued in the future', await mint({ iat: now() + 3600 }), 'issued in the future');
await rejects('a token with no subject', await mint({ sub: undefined }), 'no subject');
await rejects('a tampered signature', await mint({}, { tamper: true }), 'bad signature');
await rejects('alg=none (algorithm confusion)', await mint({}, { alg: 'none' }), 'unexpected alg');
await rejects('HS256 instead of RS256', await mint({}, { alg: 'HS256' }), 'unexpected alg');
await rejects('an unknown signing key id', await mint({}, { kid: 'rotated-away' }), 'unknown signing key');
await rejects('a malformed jwt', 'not.a.jwt.at.all', 'malformed');
await rejects('an empty token', '', 'malformed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
