import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadStoredSession, storeSession, clearStoredSession, StoredGhostSession } from '../lib/storage';

function makeSession(overrides: Partial<StoredGhostSession> = {}): StoredGhostSession {
  return {
    sessionId: 'gl_test',
    token: 'jwt-token',
    alias: 'Quiet Fox',
    emoji: '🦊',
    expiresAt: Date.now() + 3_600_000,
    privateKeyJwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' },
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'c', y: 'd' },
    fingerprint: 'AB12-CD34',
    ...overrides,
  };
}

describe('session storage (sessionStorage only)', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('stores and loads a session', () => {
    storeSession(makeSession());
    expect(loadStoredSession()?.sessionId).toBe('gl_test');
  });

  it('never writes to localStorage', () => {
    storeSession(makeSession());
    expect(localStorage.length).toBe(0);
  });

  it('rejects expired sessions and clears them', () => {
    storeSession(makeSession({ expiresAt: Date.now() - 1000 }));
    expect(loadStoredSession()).toBeNull();
    expect(sessionStorage.getItem('ghostlink:session:v1')).toBeNull();
  });

  it('clears corrupt data instead of crashing', () => {
    sessionStorage.setItem('ghostlink:session:v1', '{not json');
    expect(loadStoredSession()).toBeNull();
  });

  it('clearStoredSession removes everything', () => {
    storeSession(makeSession());
    clearStoredSession();
    expect(loadStoredSession()).toBeNull();
  });
});
