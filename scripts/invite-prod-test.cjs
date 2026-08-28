/* Invite-link E2E against production: create invite -> join via slug -> paired. */
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { io } = require('socket.io-client');
const API = 'https://ghostlink-api.onrender.com';

async function mk(alias) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  delete pub.key_ops; delete pub.ext;
  return fetch(`${API}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, publicKey: pub, fingerprint: 'fp_invite_test_0001' }),
  }).then((r) => r.json());
}

(async () => {
  const a = await mk('InviteHost');
  const b = await mk('InviteGuest');
  console.log('[A] session:', a.id, '| [B] session:', b.id);

  // A creates an invite (random slug)
  const inv = await fetch(`${API}/api/invite/create`, {
    method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then((r) => r.json());
  console.log('[A] invite created:', JSON.stringify(inv));
  if (!inv.slug || !inv.url) { console.log('INVITE CREATE FAILED ❌'); process.exit(1); }

  // A connects socket so it can receive match:found when B joins
  const A = io(API, { auth: { token: a.token }, transports: ['websocket', 'polling'], timeout: 8000 });
  const foundA = new Promise((res) => A.on('match:found', (m) => res(m)));
  await new Promise((r) => A.on('connect', r));

  // B joins via the slug (what /join?slug=... does)
  const join = await fetch(`${API}/api/invite/join`, {
    method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: inv.slug }),
  }).then((r) => r.json());
  console.log('[B] join result: ok =', join.ok, '| room =', join.roomId, '| partner =', join.partner?.alias);

  // A should get match:found over the socket
  const m = await Promise.race([foundA, new Promise((res) => setTimeout(() => res(null), 6000))]);
  console.log('[A] match:found received?', m ? `YES ✅ room=${m.roomId} partner=${m.partner?.alias}` : 'NO ❌ (timeout)');

  // Chat relay in the invite room (fire-and-forget, like the browser)
  if (join.ok && join.roomId) {
    const B = io(API, { auth: { token: b.token }, transports: ['websocket', 'polling'], timeout: 8000 });
    await new Promise((r) => B.on('connect', r));
    const gotByA = new Promise((res) => A.on('chat:message', (msg) => res(msg)));
    B.emit('chat:message', { roomId: join.roomId, data: 'hello-via-invite' });
    const msg = await Promise.race([gotByA, new Promise((res) => setTimeout(() => res(null), 6000))]);
    console.log('[A] received chat from B?', msg ? `YES ✅ "${msg.data}"` : 'NO ❌');
  }

  // Custom slug test
  const inv2 = await fetch(`${API}/api/invite/create`, {
    method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: 'ghost-test-42' }),
  }).then((r) => r.json());
  console.log('[A] custom-slug invite:', inv2.slug ? `✅ ${inv2.url}` : '❌ ' + JSON.stringify(inv2));

  console.log('\n=== INVITE FLOW VERDICT ===');
  console.log(join.ok && m ? 'INVITE LINKS LIVE ✅' : 'STILL BROKEN ❌');
  process.exit(0);
})();
