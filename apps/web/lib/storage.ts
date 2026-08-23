/**
 * Client session store — sessionStorage ONLY.
 * Deliberately NOT localStorage: closing the tab destroys the identity,
 * which is the whole point of GhostLink.
 */

export interface StoredGhostSession {
  sessionId: string;
  token: string;
  alias: string;
  emoji: string;
  expiresAt: number;
  /** My ECDH private key (JWK) — kept locally for the tab lifetime only. */
  privateKeyJwk: JsonWebKey;
  /** My public key (JWK) — uploaded to the server, delivered to partners. */
  publicKeyJwk: JsonWebKey;
  /** Safety code shown in the UI, comparable with the partner. */
  fingerprint: string;
}

const KEY = 'ghostlink:session:v1';

export function loadStoredSession(): StoredGhostSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredGhostSession;
    if (!parsed.sessionId || !parsed.token) throw new Error('corrupt');
    if (parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export function storeSession(session: StoredGhostSession): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(KEY);
}
