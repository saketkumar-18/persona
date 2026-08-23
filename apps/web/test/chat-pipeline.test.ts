import { describe, expect, it } from 'vitest';
import {
  generateSessionKeyPair,
  deriveRoomKey,
  encryptChatMessage,
  decryptChatMessage,
} from '@ghostlink/shared';

/**
 * Full client-side chat pipeline test: two simulated browser sessions derive
 * the same room key, one encrypts, the other decrypts — proving the
 * web app's chat wire format works end-to-end.
 */
describe('chat pipeline (client side)', () => {
  it('delivers an encrypted message between two sessions', async () => {
    const alice = await generateSessionKeyPair();
    const bob = await generateSessionKeyPair();
    const roomId = 'rm_pipeline';

    const keyAlice = await deriveRoomKey(alice.privateKey, bob.publicKeyJwk, roomId);
    const keyBob = await deriveRoomKey(bob.privateKey, alice.publicKeyJwk, roomId);

    const wire = await encryptChatMessage(keyAlice, 'spooky hello');
    expect(wire).not.toContain('spooky');

    expect(await decryptChatMessage(keyBob, wire)).toBe('spooky hello');
  });
});
