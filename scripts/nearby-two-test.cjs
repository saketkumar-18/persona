const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const API = 'https://ghostlink-api.onrender.com';
(async () => {
  async function mk(alias) {
    const kp = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
    delete pub.key_ops; delete pub.ext;
    return fetch(`${API}/api/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alias,publicKey:pub,fingerprint:'fp_near_00000000001'})}).then(r=>r.json());
  }
  const n1 = await mk('NearOne'); const n2 = await mk('NearTwo');
  const H = t => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
  // both beacon in the same Delhi cell
  await fetch(`${API}/api/discovery/nearby`, { method:'POST', headers: H(n1.token), body: JSON.stringify({ cellId: 'u09d3f0' }) }).then(r=>r.json());
  await fetch(`${API}/api/discovery/nearby`, { method:'POST', headers: H(n2.token), body: JSON.stringify({ cellId: 'u09d3f0' }) }).then(r=>r.json());
  const list = await fetch(`${API}/api/discovery/nearby`, { method:'POST', headers: H(n1.token), body: JSON.stringify({ cellId: 'u09d3f0' }) }).then(r=>r.json());
  console.log('NearOne sees:', JSON.stringify(list.users.map(u => u.session.alias)));
  console.log(list.users.some(u => u.session.alias === 'NearTwo') ? 'NEARBY DISCOVERY ✅' : 'NEARBY DISCOVERY ❌');

  // direct connect (the Nearby "Connect" button)
  const target = list.users.find(u => u.session.alias === 'NearTwo');
  const conn = await fetch(`${API}/api/qr/connect`, { method:'POST', headers: H(n2.token), body: JSON.stringify({ sessionId: n1.sessionId }) }).then(r=>r.json());
  console.log('connect ack:', JSON.stringify(conn).slice(0,120));
})();
