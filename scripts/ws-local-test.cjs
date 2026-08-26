const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { io } = require('socket.io-client');
const API = 'http://localhost:4015';

async function mk(alias) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  delete pub.key_ops; delete pub.ext;
  const r = await fetch(`${API}/api/sessions`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ alias, publicKey: pub, fingerprint:'fp_localws_000000001' }) });
  return r.json();
}

(async () => {
  const a = await mk('LocalA');
  const b = await mk('LocalB');
  const opts = (t) => ({ auth: { token: t }, transports: ['websocket','polling'], path:'/socket.io', timeout: 8000 });
  const A = io(API, opts(a.token));
  const B = io(API, opts(b.token));
  A.onAny((ev,...ar)=>console.log('[A] <<',ev,JSON.stringify(ar).slice(0,110)));
  B.onAny((ev,...ar)=>console.log('[B] <<',ev,JSON.stringify(ar).slice(0,110)));
  await new Promise(r=>A.on('connect',r));
  await new Promise(r=>B.on('connect',r));
  console.log('both connected');
  A.emit('match:start',{source:'random'},(ack)=>console.log('[A] ack:',JSON.stringify(ack)));
  await new Promise(r=>setTimeout(r,1200));
  B.emit('match:start',{source:'random'},(ack)=>console.log('[B] ack:',JSON.stringify(ack)));
  await new Promise(r=>setTimeout(r,2500));
  process.exit(0);
})();
