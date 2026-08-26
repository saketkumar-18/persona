/* Reproduces the exact browser behavior: send chat with NO ack callback. */
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { io } = require('socket.io-client');
const API = 'http://localhost:4016';

async function mk(alias) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  delete pub.key_ops; delete pub.ext;
  return fetch(`${API}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, publicKey: pub, fingerprint: 'fp_noack_0000000001' }),
  }).then((r) => r.json());
}

(async () => {
  const a = await mk('NoAckA');
  const b = await mk('NoAckB');
  const opts = (t) => ({ auth: { token: t }, transports: ['websocket', 'polling'], path: '/socket.io', timeout: 8000 });
  const A = io(API, opts(a.token));
  const B = io(API, opts(b.token));
  await new Promise((r) => A.on('connect', r));
  await new Promise((r) => B.on('connect', r));
  const gotByB = [];
  const gotByA = [];
  B.on('chat:message', (m) => gotByB.push(m.data));
  A.on('chat:message', (m) => gotByA.push(m.data));

  A.emit('match:start', { source: 'random' }, (ack) => console.log('[A] match ack:', JSON.stringify(ack)));
  await new Promise((r) => setTimeout(r, 800));
  B.emit('match:start', { source: 'random' }, (ack) => {
    console.log('[B] matched:', ack.matched, 'room:', ack.roomId);
    global.roomId = ack.roomId;
  });
  await new Promise((r) => setTimeout(r, 1200));
  const roomId = global.roomId;
  if (!roomId) { console.log('MATCH FAILED'); process.exit(1); }

  // THE KEY PART — fire-and-forget, exactly like apps/web/lib/socket.ts sendChat:
  A.emit('chat:message', { roomId, data: 'hello-from-A-no-ack' });
  B.emit('chat:message', { roomId, data: 'hii-from-B-no-ack' });
  await new Promise((r) => setTimeout(r, 1500));

  console.log('B received A msg (no-ack send)?', gotByB.includes('hello-from-A-no-ack') ? 'YES ✅' : `NO ❌ ${JSON.stringify(gotByB)}`);
  console.log('A received B msg (no-ack send)?', gotByA.includes('hii-from-B-no-ack') ? 'YES ✅' : `NO ❌ ${JSON.stringify(gotByA)}`);
  process.exit(0);
})();
