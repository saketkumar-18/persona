import { describe, expect, it } from 'vitest';
import {
  generateSessionKeyPair,
  deriveRoomKey,
  encryptChatMessage,
  decryptChatMessage,
  publicKeyFingerprint,
  bytesToBase64Url,
  base64UrlToBytes,
  MAX_CHAT_PLAINTEXT_BYTES,
} from '../src/crypto';

describe('base64url helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
  });

  it('never emits padding, + or /', () => {
    for (const len of [1, 2, 3, 4, 5, 16, 31]) {
      const bytes = new Uint8Array(len).fill(255);
      const s = bytesToBase64Url(bytes);
      expect(s).not.toMatch(/[+/=]/);
    }
  });
});

describe('session key exchange + room keys', () => {
  it('derives the same room key on both ends (ECDH symmetry)', async () => {
    const alice = await generateSessionKeyPair();
    const bob = await generateSessionKeyPair();
    const roomId = 'rm_test123';

    const keyA = await deriveRoomKey(alice.privateKey, bob.publicKeyJwk, roomId);
    const keyB = await deriveRoomKey(bob.privateKey, alice.publicKeyJwk, roomId);

    const msg = await encryptChatMessage(keyA, 'hello bob');
    expect(await decryptChatMessage(keyB, msg)).toBe('hello bob');
  });

  it('derives different keys for different room ids', async () => {
    const alice = await generateSessionKeyPair();
    const bob = await generateSessionKeyPair();

    const k1 = await deriveRoomKey(alice.privateKey, bob.publicKeyJwk, 'rm_one');
    const k2 = await deriveRoomKey(alice.privateKey, bob.publicKeyJwk, 'rm_two');

    const cipher = await encryptChatMessage(k1, 'room scoped');
    expect(await decryptChatMessage(k1, cipher)).toBe('room scoped');
    expect(await decryptChatMessage(k2, cipher)).toBeNull();
  });

  it('public key JWK exposes no secret material', async () => {
    const pair = await generateSessionKeyPair();
    const jwk = pair.publicKeyJwk;
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    expect(jwk.x).toBeTruthy();
    expect(jwk.y).toBeTruthy();
    expect(jwk.d).toBeUndefined();
  });

  it('fingerprint is stable and formatted XXXX-XXXX', async () => {
    const pair = await generateSessionKeyPair();
    const fp1 = await publicKeyFingerprint(pair.publicKeyJwk);
    const fp2 = await publicKeyFingerprint(pair.publicKeyJwk);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const other = await generateSessionKeyPair();
    expect(await publicKeyFingerprint(other.publicKeyJwk)).not.toBe(fp1);
  });
});

describe('chat envelopes (AES-256-GCM)', () => {
  it('encrypts and decrypts a payload end-to-end', async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const keyA = await deriveRoomKey(a.privateKey, b.publicKeyJwk, 'rm_x');

    const envelope = await encryptChatMessage(keyA, 'GhostLink 🌫️ privacy test');
    const parsed = JSON.parse(envelope) as { v: number; iv: string; ct: string };
    expect(parsed.v).toBe(1);
    // envelope must not contain plaintext
    expect(envelope).not.toContain('privacy');

    expect(await decryptChatMessage(keyA, envelope)).toBe('GhostLink 🌫️ privacy test');
  });

  it('returns null for tampered ciphertext', async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const keyA = await deriveRoomKey(a.privateKey, b.publicKeyJwk, 'rm_y');

    const envelope = JSON.parse(await encryptChatMessage(keyA, 'tamper me')) as {
      v: number;
      iv: string;
      ct: string;
    };
    const tamperedBytes = base64UrlToBytes(envelope.ct);
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 0xff;
    envelope.ct = bytesToBase64Url(tamperedBytes);

    expect(await decryptChatMessage(keyA, JSON.stringify(envelope))).toBeNull();
  });

  it('returns null for malformed input instead of throwing', async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const keyA = await deriveRoomKey(a.privateKey, b.publicKeyJwk, 'rm_z');

    expect(await decryptChatMessage(keyA, 'not json')).toBeNull();
    expect(await decryptChatMessage(keyA, '{"v":2,"iv":"","ct":""}')).toBeNull();
    expect(await decryptChatMessage(keyA, '{"v":1}')).toBeNull();
    expect(await decryptChatMessage(keyA, '{"v":1,"iv":"AAAA","ct":"AAAA"}')).toBeNull();
  });

  it('rejects empty and oversized plaintext', async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const keyA = await deriveRoomKey(a.privateKey, b.publicKeyJwk, 'rm_w');

    await expect(encryptChatMessage(keyA, '')).rejects.toThrow();
    await expect(
      encryptChatMessage(keyA, 'x'.repeat(MAX_CHAT_PLAINTEXT_BYTES + 1)),
    ).rejects.toThrow();
  });
});
