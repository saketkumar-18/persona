/**
 * Session lifecycle hook.
 *
 * Session creation generates an ephemeral ECDH P-256 key pair locally. The
 * PRIVATE key never leaves the browser (kept in sessionStorage only, dies
 * with the tab). The PUBLIC key is sent to the server once and delivered to
 * partners at pairing time so both ends can derive the room key.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  GHOST_EMOJIS,
  generateSessionKeyPair,
  publicKeyFingerprint,
} from '@persona/shared';
import { api } from './api';
import { loadStoredSession, storeSession, clearStoredSession, StoredGhostSession } from './storage';

export type ConnectionState = 'none' | 'starting' | 'active' | 'expired' | 'error';

export interface SessionManager {
  state: ConnectionState;
  session: StoredGhostSession | null;
  error: string | null;
  create: (alias?: string, emoji?: string) => Promise<StoredGhostSession | null>;
  destroy: () => Promise<void>;
  updateProfile: (patch: { alias?: string; emoji?: string }) => Promise<void>;
}

async function importPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

export function useSessionManager(): SessionManager {
  const [session, setSession] = useState<StoredGhostSession | null>(null);
  const [state, setState] = useState<ConnectionState>('none');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = loadStoredSession();
    if (existing) {
      setSession(existing);
      setState('active');
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const msLeft = session.expiresAt - Date.now();
    if (msLeft <= 0) return;
    const t = setTimeout(() => {
      setState('expired');
      clearStoredSession();
      setSession(null);
    }, msLeft);
    return () => clearTimeout(t);
  }, [session]);

  const create = useCallback(async (alias?: string, emoji?: string) => {
    setState('starting');
    setError(null);
    try {
      const keys = await generateSessionKeyPair();
      const fingerprint = await publicKeyFingerprint(keys.publicKeyJwk);
      const res = await api.createSession({
        alias,
        emoji: emoji && (GHOST_EMOJIS as readonly string[]).includes(emoji) ? emoji : undefined,
        publicKey: keys.publicKeyJwk,
        fingerprint,
      });
      const privateKeyJwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
      const stored: StoredGhostSession = {
        sessionId: res.sessionId,
        token: res.token,
        alias: res.session.alias,
        emoji: res.session.emoji,
        expiresAt: res.session.expiresAt,
        privateKeyJwk,
        publicKeyJwk: keys.publicKeyJwk,
        fingerprint,
      };
      storeSession(stored);
      setSession(stored);
      setState('active');
      return stored;
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'failed to create session');
      return null;
    }
  }, []);

  const destroy = useCallback(async () => {
    if (session) {
      try {
        await api.destroySession(session.token);
      } catch {
        // ignore — the token may already be dead
      }
    }
    clearStoredSession();
    setSession(null);
    setState('none');
  }, [session]);

  const updateProfile = useCallback(
    async (patch: { alias?: string; emoji?: string }) => {
      if (!session) return;
      const res = await api.updateSession(session.token, patch);
      const next = { ...session, alias: res.session.alias, emoji: res.session.emoji };
      storeSession(next);
      setSession(next);
    },
    [session],
  );

  return { state, session, error, create, destroy, updateProfile };
}

export async function restorePrivateKey(stored: StoredGhostSession): Promise<CryptoKey> {
  return importPrivate(stored.privateKeyJwk);
}
