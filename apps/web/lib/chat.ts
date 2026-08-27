'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deriveRoomKey,
  encryptChatMessage,
  decryptChatMessage,
  type PartnerInfo,
} from '@persona/shared';
import type { StoredGhostSession } from './storage';

export interface ChatMessage {
  id: string;
  mine: boolean;
  text: string;
  at: number;
  /** true when the envelope could not be decrypted (shouldn't normally happen). */
  undecryptable?: boolean;
}

/**
 * Derives the per-room AES-256-GCM key from my ephemeral ECDH private key +
 * partner's public key, encrypts outgoing chat, decrypts incoming envelopes.
 */
export function useEncryptedChat(
  session: StoredGhostSession | null,
  roomId: string | null,
  partner: PartnerInfo | null,
  onSendEnvelope: (roomId: string, envelope: string) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ready, setReady] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const counterRef = useRef(0);

  useEffect(() => {
    setMessages([]);
    keyRef.current = null;
    setReady(false);
  }, [roomId]);

  const ensureKey = useCallback(async (): Promise<CryptoKey | null> => {
    if (keyRef.current) return keyRef.current;
    if (!roomId || !partner?.publicKey) return null;
    const myPrivate = await crypto.subtle.importKey(
      'jwk',
      session!.privateKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    keyRef.current = await deriveRoomKey(myPrivate, partner.publicKey, roomId);
    setReady(true);
    return keyRef.current;
  }, [roomId, partner, session]);

  const pushMessage = useCallback((msg: Omit<ChatMessage, 'id'>) => {
    setMessages((m) => [...m, { id: `m_${Date.now()}_${(counterRef.current += 1)}`, ...msg }]);
  }, []);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (!roomId) return false;
      const key = await ensureKey();
      if (!key) return false;
      const envelope = await encryptChatMessage(key, text);
      pushMessage({ mine: true, text, at: Date.now() });
      onSendEnvelope(roomId, envelope);
      return true;
    },
    [ensureKey, roomId, onSendEnvelope, pushMessage],
  );

  const receive = useCallback(
    async (envelope: string) => {
      const key = await ensureKey();
      const text = key ? await decryptChatMessage(key, envelope) : null;
      if (text === null) {
        pushMessage({ mine: false, text: '', at: Date.now(), undecryptable: true });
        return;
      }
      pushMessage({ mine: false, text, at: Date.now() });
    },
    [ensureKey, pushMessage],
  );

  return { messages, ready, send, receive };
}
