/**
 * Client-side end-to-end chat encryption for GhostLink.
 *
 * Model:
 *  1. Each session generates an ephemeral ECDH P-256 key pair locally at
 *     session creation. The PUBLIC key (JWK, public fields only) is uploaded
 *     once to the server (REST control plane) and delivered to partners.
 *  2. When two sessions are paired, each derives a per-room AES-256-GCM key:
 *     HKDF-SHA256(ECDH(myPriv, theirPub), salt=roomId, info="ghostlink/chat/v1").
 *  3. Messages are AES-256-GCM encrypted client-side into opaque envelopes
 *     (`encodeEnvelope`) and relayed verbatim by the server.
 *
 * Trust boundary: the server facilitates pairing (delivers public keys) and
 * relays ciphertext. It never holds private keys or room keys. This is not
 * keyless E2E — pairing goes through the server, so a compromised server
 * could substitute keys. Clients surface the partner's public-key fingerprint
 * ("safety code") in the UI so users can compare it out-of-band if they wish.
 */

const WEB_CRYPTO: SubtleCrypto = (() => {
  const c =
    (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle ??
    (globalThis as { crypto?: { webcrypto?: { subtle?: SubtleCrypto } } }).crypto?.webcrypto?.subtle;
  if (!c) throw new Error('Web Crypto (SubtleCrypto) is not available in this runtime');
  return c;
})();

export interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /** Public key as JWK — safe to store/relay; contains no secret material. */
  publicKeyJwk: JsonWebKey;
}

export interface ChatEnvelope {
  v: 1;
  /** base64url(IV, 12 bytes) */
  iv: string;
  /** base64url(ciphertext || gcm-tag) */
  ct: string;
}

export const CHAT_ENVELOPE_VERSION = 1;
/** Max plaintext UTF-8 byte length for one chat message. */
export const MAX_CHAT_PLAINTEXT_BYTES = 4_000;

// ---------------------------------------------------------------------------
// base64url helpers (no padding)
// ---------------------------------------------------------------------------

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i] as number);
  }
  const b64 =
    typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === 'function') {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  const c = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('crypto.getRandomValues is not available');
  c.getRandomValues(buf);
  return buf;
}

/** Type-erased view of a Uint8Array accepted by WebCrypto BufferSource params. */
function asBuffer(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

// ---------------------------------------------------------------------------
// Key generation + exchange
// ---------------------------------------------------------------------------

export async function generateSessionKeyPair(): Promise<KeyPair> {
  const pair = await WEB_CRYPTO.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicKeyJwk = await WEB_CRYPTO.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyJwk };
}

export async function importPartnerPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return WEB_CRYPTO.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

/** Derive the per-room AES key from my private key + partner public key + room id. */
export async function deriveRoomKey(
  myPrivateKey: CryptoKey,
  partnerPublicKeyJwk: JsonWebKey,
  roomId: string,
): Promise<CryptoKey> {
  const partnerKey = await importPartnerPublicKey(partnerPublicKeyJwk);
  const sharedBits = new Uint8Array(
    await WEB_CRYPTO.deriveBits({ name: 'ECDH', public: partnerKey }, myPrivateKey, 256),
  );
  const hkdfKey = await WEB_CRYPTO.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return WEB_CRYPTO.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`room:${roomId}`),
      info: new TextEncoder().encode('ghostlink/chat/v1'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Short, human-comparable fingerprint of a public key (safety code). */
export async function publicKeyFingerprint(jwk: JsonWebKey): Promise<string> {
  const bytes = await WEB_CRYPTO.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ x: jwk.x, y: jwk.y })),
  );
  const digest = bytesToBase64Url(new Uint8Array(bytes));
  // 8 chars, uppercase, grouped: "AB12-CD34"
  const chars = digest.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

// ---------------------------------------------------------------------------
// Envelope encrypt / decrypt
// ---------------------------------------------------------------------------

export async function encryptChatMessage(roomKey: CryptoKey, plaintext: string): Promise<string> {
  const plainBytes = new TextEncoder().encode(plaintext);
  if (plainBytes.length === 0) throw new Error('empty message');
  if (plainBytes.length > MAX_CHAT_PLAINTEXT_BYTES) {
    throw new Error(`message too large (max ${MAX_CHAT_PLAINTEXT_BYTES} bytes)`);
  }
  const iv = randomBytes(12);
  const sealed = new Uint8Array(
    await WEB_CRYPTO.encrypt({ name: 'AES-GCM', iv: asBuffer(iv) }, roomKey, asBuffer(plainBytes)),
  );
  const envelope: ChatEnvelope = {
    v: CHAT_ENVELOPE_VERSION,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(sealed),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt an envelope. Returns null for malformed/tampered input instead of
 * throwing, so UI can show a neutral "could not decrypt" state.
 */
export async function decryptChatMessage(
  roomKey: CryptoKey,
  envelopeJson: string,
): Promise<string | null> {
  try {
    const envelope = JSON.parse(envelopeJson) as ChatEnvelope;
    if (envelope.v !== CHAT_ENVELOPE_VERSION) return null;
    if (typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') return null;
    const iv = base64UrlToBytes(envelope.iv);
    const ct = base64UrlToBytes(envelope.ct);
    if (iv.length !== 12 || ct.length === 0) return null;
    const plain = new Uint8Array(
      await WEB_CRYPTO.decrypt({ name: 'AES-GCM', iv: asBuffer(iv) }, roomKey, asBuffer(ct)),
    );
    if (plain.length > MAX_CHAT_PLAINTEXT_BYTES) return null;
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
