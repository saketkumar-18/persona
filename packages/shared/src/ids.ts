/** ID + code generation. Uses Web Crypto randomness on browser AND node. */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomBytesCompat(len: number): Uint8Array {
  const globalCrypto = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (globalCrypto?.getRandomValues) {
    const buf = new Uint8Array(len);
    globalCrypto.getRandomValues(buf);
    return buf;
  }
  throw new Error('No CSPRNG available in this runtime');
}

export function randomString(length: number): string {
  const bytes = randomBytesCompat(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET.charAt((bytes[i] ?? 0) % ALPHABET.length);
  }
  return out;
}

/** Session id: 24 chars of base36. */
export function generateSessionId(): string {
  return `gl_${randomString(24)}`;
}

/** Room id: 24 chars. */
export function generateRoomId(): string {
  return `rm_${randomString(24)}`;
}

/** 6-char QR pairing code (visually unambiguous: no 0/o/1/i/l). */
export function generateQrCode(): string {
  const safe = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytesCompat(8);
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += safe.charAt((bytes[i] ?? 0) % safe.length);
  }
  return `ql_${out}`;
}
