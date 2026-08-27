import {
  CreateSessionResponse,
  SessionResponse,
  NearbyListResponse,
  GhostZoneResponse,
  CreateQrResponse,
  RedeemQrResponse,
  ConnectResponse,
  BlockResponse,
  ReportResponse,
  StatusSnapshot,
  OkResponse,
  CreateInviteResponse,
  JoinInviteResponse,
} from '@ghostlink/shared';
import { API_BASE } from './env';

async function http<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = body?.error?.message ?? body?.message ?? res.statusText;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  createSession(payload: {
    alias?: string;
    emoji?: string;
    ttlSeconds?: number;
    publicKey?: JsonWebKey;
    fingerprint?: string;
  }): Promise<CreateSessionResponse> {
    return http('/sessions', { method: 'POST', body: JSON.stringify(payload) });
  },

  getSession(token: string): Promise<SessionResponse> {
    return http('/sessions/me', {}, token);
  },

  updateSession(token: string, patch: { alias?: string; emoji?: string }): Promise<SessionResponse> {
    return http('/sessions/me', { method: 'PATCH', body: JSON.stringify(patch) }, token);
  },

  destroySession(token: string): Promise<OkResponse> {
    return http('/sessions/me', { method: 'DELETE' }, token);
  },

  nearby(token: string, cellId: string): Promise<NearbyListResponse> {
    return http('/discovery/nearby', { method: 'POST', body: JSON.stringify({ cellId }) }, token);
  },

  enterGhostZone(token: string, cellId: string): Promise<GhostZoneResponse> {
    return http('/discovery/zone', { method: 'POST', body: JSON.stringify({ cellId }) }, token);
  },

  createQr(token: string): Promise<CreateQrResponse> {
    return http('/qr/create', { method: 'POST' }, token);
  },

  redeemQr(token: string, code: string): Promise<RedeemQrResponse> {
    return http('/qr/redeem', { method: 'POST', body: JSON.stringify({ code }) }, token);
  },

  connectDirect(token: string, sessionId: string): Promise<ConnectResponse> {
    return http('/qr/connect', { method: 'POST', body: JSON.stringify({ sessionId }) }, token);
  },

  createInvite(token: string, slug?: string): Promise<CreateInviteResponse> {
    return http('/invite/create', { method: 'POST', body: JSON.stringify(slug ? { slug } : {}) }, token);
  },

  joinInvite(token: string, slug: string): Promise<JoinInviteResponse> {
    return http('/invite/join', { method: 'POST', body: JSON.stringify({ slug }) }, token);
  },

  block(token: string, sessionId: string, roomId?: string, reason?: string): Promise<BlockResponse> {
    return http('/moderation/block', { method: 'POST', body: JSON.stringify({ sessionId, roomId, reason }) }, token);
  },

  report(token: string, sessionId: string, roomId?: string, category?: string, note?: string): Promise<ReportResponse> {
    return http('/moderation/report', { method: 'POST', body: JSON.stringify({ sessionId, roomId, category, note }) }, token);
  },

  status(): Promise<StatusSnapshot> {
    return http('/status');
  },
};
