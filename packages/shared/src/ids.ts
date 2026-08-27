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

/** Invite slug: 2-3 words + number, e.g., "cozy-forest-42". */
const INVITE_ADJECTIVES = [
  'cozy', 'wild', 'quiet', 'swift', 'calm', 'bright', 'deep', 'soft', 'warm', 'cool',
  'gentle', 'keen', 'vivid', 'mellow', 'crisp', 'still', 'fresh', 'noble', 'kind', 'true',
];
const INVITE_NOUNS = [
  'forest', 'river', 'mountain', 'meadow', 'valley', 'ocean', 'sky', 'star', 'moon', 'sun',
  'leaf', 'stone', 'breeze', 'wave', 'cloud', 'path', 'shore', 'garden', 'harbor', 'cove',
];

export function generateInviteSlug(): string {
  const adj = INVITE_ADJECTIVES[Math.floor(Math.random() * INVITE_ADJECTIVES.length)];
  const noun = INVITE_NOUNS[Math.floor(Math.random() * INVITE_NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100; // 100-999
  return `${adj}-${noun}-${num}`;
}
