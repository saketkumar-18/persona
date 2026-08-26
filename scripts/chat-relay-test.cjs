const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { io } = require('socket.io-client');
const API = 'http://localhost:4015';

async function mk(alias) {
  const kp = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  delete pub.key_ops; delete pub.ext;
  return fetch(`${API}/api/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alias,publicKey:pub,fingerprint:'fp_relay_00000000001'})}).then(r=>r.json());
}

(async () => {
  const a = await mk('RelayA'); const b = await mk('RelayB');
  const opts = (t) => ({ auth:{token:t}, transports:['websocket','polling'], path:'/socket.io', timeout: 8000 });
  const A = io(API, opts(a.token)); const B = io(API, opts(b.token));
  await new Promise(r=>A.on('connect',r)); await new Promise(r=>B.on('connect',r));
  let roomId = null; let receivedByB = []; let receivedByA = [];
  A.on('chat:message', m => receivedByA.push(m.data));
  B.on('chat:message', m => receivedByB.push(m.data));
  B.on('room:left', p => console.log('[B] room:left', JSON.stringify(p)));

  A.emit('match:start',{source:'random'},ack=>console.log('[A]',JSON.stringify(ack)));
  await new Promise(r=>setTimeout(r,1000));
  B.emit('match:start',{source:'random'},ack=>{
    console.log('[B] matched:', ack.matched, 'roomId:', ack.roomId);
    roomId = ack.roomId;
    // join the room explicitly like the web client does
    if (roomId) {
      A.emit('room:join', { roomId }, r1 => console.log('[A] room:join ack:', JSON.stringify(r1)));
      B.emit('room:join', { roomId }, r2 => console.log('[B] room:join ack:', JSON.stringify(r2)));
    }
  });
  await new Promise(r=>setTimeout(r,1500));

  // chat both directions
  A.emit('chat:message', { roomId, data: 'cipherAAA-from-A' }, r => console.log('[A] send1 ack:', JSON.stringify(r)));
  B.emit('chat:message', { roomId, data: 'cipherBBB-from-B' }, r => console.log('[B] send2 ack:', JSON.stringify(r)));
  await new Promise(r=>setTimeout(r,1500));

  console.log('\nRESULT:');
  console.log('B received from A?', receivedByB.includes('cipherAAA-from-A') ? 'YES ✅' : `NO ❌ got=${JSON.stringify(receivedByB)}`);
  console.log('A received from B?', receivedByA.includes('cipherBBB-from-B') ? 'YES ✅' : `NO ❌ got=${JSON.stringify(receivedByA)}`);

  // leave flow
  A.emit('room:leave', {}, r => console.log('[A] leave ack:', JSON.stringify(r)));
  await new Promise(r=>setTimeout(r,800));
  process.exit(0);
})();
