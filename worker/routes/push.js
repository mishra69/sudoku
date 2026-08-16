// Web Push endpoints.
//
// The encryption and VAPID signing live in webpush-edge; everything here is
// storage and routing. Apple's push service accepts only aes128gcm, and gets
// it wrong silently (201 Created, nothing displayed), which is the main reason
// not to hand-roll this part.

import { createPusher } from 'webpush-edge';

// Public: called from the service worker's pushsubscriptionchange handler,
// which has no session token. Authorisation is possession of the old endpoint —
// a capability URL only that device and this server ever held. It can only swap
// one endpoint for another on the same player, never read or send anything.
export async function handlePushResubscribe(request, env) {
  const { subscription, oldEndpoint } = await request.json().catch(() => ({}));
  if (!subscription?.endpoint || !oldEndpoint) {
    return json({ ok: false, error: 'need subscription and oldEndpoint' }, 400);
  }
  const row = await env.DB
    .prepare('SELECT player_id FROM push_subscriptions WHERE endpoint = ?')
    .bind(oldEndpoint).first();
  if (!row) return json({ ok: false, error: 'unknown endpoint' }, 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(oldEndpoint),
    env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, player_id, subscription, last_seen_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET
         subscription = excluded.subscription, last_seen_at = datetime('now')`
    ).bind(subscription.endpoint, row.player_id, JSON.stringify(subscription)),
  ]);
  return json({ ok: true });
}

export async function handlePush(path, method, request, playerId, env) {
  // The public key is not secret — the browser needs it as applicationServerKey.
  if (path === '/push/key') {
    return json({ key: env.VAPID_PUBLIC_KEY || null });
  }

  if (path === '/push/subscribe' && method === 'POST') {
    const { subscription } = await request.json().catch(() => ({}));
    if (!subscription?.endpoint) return json({ ok: false, error: 'no subscription' }, 400);
    // subscribe() already returns the device count — re-listing was an extra
    // read of rows we'd just written.
    const devices = await pusher(env).subscribe(playerId, subscription);
    return json({ ok: true, devices });
  }

  if (path === '/push/unsubscribe' && method === 'POST') {
    const { endpoint } = await request.json().catch(() => ({}));
    const devices = await pusher(env).unsubscribe(playerId, endpoint ? endpoint : { all: true });
    return json({ ok: true, devices });
  }

  // Fire a one-off push to this player's own devices, so delivery can be
  // verified without waiting for a real trigger. Status codes are the useful
  // part: 201 accepted, 403 VAPID mismatch, 400 encryption, 410 subscription gone.
  if (path === '/push/test' && method === 'POST') {
    const subs = await pusher(env).list(playerId);
    if (!subs.length) return json({ ok: false, error: 'no subscription on file' }, 404);

    const result = await pusher(env).send(playerId, {
      title: 'Sudoku',
      body: 'Test notification — push is wired up correctly.',
      navigate: '/',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'sudoku-test',
    });
    return json({
      ok: result.sent > 0,
      sent: result.sent,
      failed: result.failed,
      pruned: result.pruned,
      // Status only — the endpoint itself is a capability URL and stays out of responses.
      statuses: (result.results || []).map(r => r.status ?? r.error ?? 'unknown'),
    });
  }

  return json({ error: 'Not found' }, 404);
}

function pusher(env) {
  return createPusher({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateJwk: env.VAPID_PRIVATE_JWK,
    contact: 'mailto:mishabhi@gmail.com',
    store: d1Store(env.DB),
  });
}

// webpush-edge ships a KV-backed store; this app only has D1, and subscriptions
// belong to players that already live there. The contract is just get/set.
function d1Store(db) {
  return {
    async get(playerId) {
      const { results } = await db
        .prepare('SELECT subscription FROM push_subscriptions WHERE player_id = ?')
        .bind(playerId).all();
      return (results || []).map(r => JSON.parse(r.subscription));
    },
    async set(playerId, subs) {
      // The library hands back the whole list after any change. Delete only the
      // rows that fell out of it, rather than clearing and reinserting — a
      // blanket delete meant the ON CONFLICT below never fired, so created_at
      // was silently reset on every re-subscribe.
      const keep = subs.map(s => s.endpoint);
      const stmts = [];
      if (keep.length) {
        stmts.push(db.prepare(
          `DELETE FROM push_subscriptions
           WHERE player_id = ? AND endpoint NOT IN (${keep.map(() => '?').join(',')})`
        ).bind(playerId, ...keep));
      } else {
        stmts.push(db.prepare('DELETE FROM push_subscriptions WHERE player_id = ?').bind(playerId));
      }
      for (const s of subs) {
        stmts.push(db.prepare(
          `INSERT INTO push_subscriptions (endpoint, player_id, subscription, last_seen_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(endpoint) DO UPDATE SET
             player_id = excluded.player_id,
             subscription = excluded.subscription,
             last_seen_at = datetime('now')`
        ).bind(s.endpoint, playerId, JSON.stringify(s)));
      }
      await db.batch(stmts);
    },
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
