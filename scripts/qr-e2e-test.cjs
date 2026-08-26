const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const API = 'http://localhost:4015';
(async () => {
  async function mk(alias) {
    const kp = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
    const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
    delete pub.key_ops; delete pub.ext;
    return fetch(`${API}/api/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({alias,publicKey:pub,fingerprint:'fp_qre2e_000000001'})}).then(r=>r.json());
  }
  const host = await mk('QrHost'); const joiner = await mk('QrJoin');
  const H = t => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
  const qr = await fetch(`${API}/api/qr/create`, { method:'POST', headers: H(host.token) }).then(r=>r.json());
  console.log('QR created:', JSON.stringify(qr));
  const red = await fetch(`${API}/api/qr/redeem`, { method:'POST', headers: H(joiner.token), body: JSON.stringify({ code: qr.code }) }).then(r=>r.json());
  console.log('Redeemed:', JSON.stringify(red).slice(0, 200));
  console.log(red.ok && red.roomId ? 'QR PAIRING ✅' : 'QR PAIRING ❌');
})();
