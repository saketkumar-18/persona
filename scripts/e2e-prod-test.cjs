/* Live production E2E test: two clients, real server.
 * Reproduces: session create → WS connect → random match → chat A→B and B→A → QR pair. */
const API = 'https://ghostlink-api.onrender.com';

// minimal WebCrypto polyfill via node:crypto webcrypto
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { io } = require('socket.io-client');

const FP = 'fp_test_abcdef123456'; // ≤24 chars per zod schema

async function makeSession(alias) {
  // ECDH P-256 keypair, same shape the browser sends
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  delete pubJwk.key_ops; delete pubJwk.ext;
  const res = await fetch(`${API}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, publicKey: pubJwk, fingerprint: FP }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`create failed ${res.status}: ${JSON.stringify(body)}`);
  console.log(`[${alias}] session created: ${body.sessionId} alias=${body.session.alias} emoji=${body.session.emoji}`);
  console.log(`[${alias}] publicKey stored?`, JSON.stringify(body.session.publicKey ?? null).slice(0, 60));
  return { ...body, pubJwk };
}

function connect(token, label) {
  return new Promise((resolve, reject) => {
    const sock = io(API, { auth: { token }, transports: ['websocket', 'polling'], path: '/socket.io', reconnectionAttempts: 2, timeout: 15000 });
    const timer = setTimeout(() => reject(new Error(`[${label}] connect timeout`)), 20000);
    sock.on('connect', () => { clearTimeout(timer); console.log(`[${label}] WS connected id=${sock.id}`); resolve(sock); });
    sock.on('connect_error', (e) => { clearTimeout(timer); reject(new Error(`[${label}] connect_error: ${e.message}`)); });
    sock.on('error', (f) => console.log(`[${label}] error frame:`, JSON.stringify(f)));
  });
}

function emitAck(sock, event, payload, label) {
  return new Promise((resolve) => {
    sock.emit(event, payload, (ack) => { console.log(`[${label}] ${event} ack:`, JSON.stringify(ack)); resolve(ack); });
    setTimeout(() => { console.log(`[${label}] ${event} ack TIMEOUT`); resolve(null); }, 15000);
  });
}

(async () => {
  let A, B;
  try {
    console.log('=== 1) session creation ===');
    const a = await makeSession('Test Alpha');
    const b = await makeSession('Test Bravo');

    console.log('\n=== 2) websocket connect ===');
    A = await connect(a.token, 'A');
    B = await connect(b.token, 'B');

    // listeners for pushed events
    A.on('match:found', (p) => console.log('[A] match:found →', JSON.stringify(p).slice(0, 140)));
    B.on('match:found', (p) => console.log('[B] match:found →', JSON.stringify(p).slice(0, 140)));
    A.on('chat:message', (m) => console.log('[A] chat:message ←', JSON.stringify(m).slice(0, 100)));
    B.on('chat:message', (m) => console.log('[B] chat:message ←', JSON.stringify(m).slice(0, 100)));

    console.log('\n=== 3) random match ===');
    await emitAck(A, 'match:start', { source: 'random' }, 'A');
    await new Promise((r) => setTimeout(r, 1500));
    const ackB = await emitAck(B, 'match:start', { source: 'random' }, 'B');
    await new Promise((r) => setTimeout(r, 3000));

    if (!ackB?.matched) { console.log('!! MATCH FAILED — stopping chat test'); }
    else {
      const roomId = ackB.roomId;
      console.log(`\n=== 4) chat relay in room ${roomId} ===`);
      console.log('partner.publicKey present?', !!(ackB.partner && ackB.partner.publicKey));
      await emitAck(A, 'chat:message', { roomId, data: 'envelopeFromA_fakeciphertext' }, 'A');
      await new Promise((r) => setTimeout(r, 2000));
      await emitAck(B, 'chat:message', { roomId, data: 'envelopeFromB_fakeciphertext' }, 'B');
      await new Promise((r) => setTimeout(r, 2000));
    }

    console.log('\n=== 5) QR pairing (fresh sessions C,D) ===');
    const c = await makeSession('Test Charlie');
    const d = await makeSession('Test Delta');
    const C = await connect(c.token, 'C');
    D2 = await connect(d.token, 'D');
    var D2_ref = D2;
    const qres = await fetch(`${API}/api/qr/create`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' } }).then((r) => r.json());
    console.log('[C] qr create:', JSON.stringify(qres).slice(0, 120));
    if (qres.code) {
      const rred = await fetch(`${API}/api/qr/redeem`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: qres.code }) }).then((r) => r.json());
      console.log('[D] redeem:', JSON.stringify(rred).slice(0, 160));
    }
    process.exitCode = 0;
  } catch (e) {
    console.error('E2E FAILURE:', e.message);
    process.exitCode = 1;
  } finally {
    try { A?.disconnect(); } catch {}
    try { B?.disconnect(); } catch {}
  }
})();
