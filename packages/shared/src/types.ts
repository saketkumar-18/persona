/** Core domain types shared between the web app and the server. */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type SessionStatus = 'idle' | 'matching' | 'in_chat' | 'offline';

export type MatchSource = 'random' | 'nearby';

export type GeoPrecisionLevel = 'standard' | 'reduced';

export interface PresenceLocation {
  /** Coarsened cell-center latitude (raw GPS never stored). */
  lat: number;
  lng: number;
  cellId: string;
  precision: GeoPrecisionLevel;
  /** Travel/event mode: presence stays without live GPS updates. */
  travel?: boolean;
  updatedAt: number;
}

export interface Session {
  id: string;
  alias: string;
  emoji: string;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
  presence?: PresenceLocation | null;
}

export interface Room {
  id: string;
  members: string[];
  createdAt: number;
  expiresAt: number;
}

/** Profile shared between paired sessions. */
export interface PartnerInfo {
  id: string;
  alias: string;
  emoji: string;
  /** ECDH P-256 public key (JWK) — public material only, used to derive the room key. */
  publicKey?: JsonWebKey;
  /** Short human-comparable fingerprint of the public key (safety code). */
  fingerprint?: string;
}

export interface CreateSessionRequest {
  alias?: string;
  emoji?: string;
  /** Requested lifetime in seconds. Default 4h, max capped by server. */
  ttlSeconds?: number;
  /** ECDH P-256 public key (JWK) — no secret material. */
  publicKey?: JsonWebKey;
}

export interface CreateSessionResponse {
  sessionId: string;
  /** One-time, session-scoped JWT for realtime connect + protected API. */
  token: string;
  session: Session;
}

export interface SessionResponse {
  session: Session;
}

export interface OkResponse {
  ok: boolean;
}

export interface UpdateSessionRequest {
  alias?: string;
  emoji?: string;
  /** Extend lifetime (capped by server max). */
  ttlSeconds?: number;
  publicKey?: JsonWebKey;
}

export interface PresenceSetRequest {
  cellId: string;
  travel?: boolean;
}

export interface PresenceClearRequest {}

export interface NearUser {
  session: Pick<Session, 'id' | 'alias' | 'emoji'>;
  distanceMeters: number;
  bearingDeg: number | null;
  travel?: boolean;
}

export interface NearbyListResponse {
  cellId: string;
  users: NearUser[];
}

export interface GhostZoneJoinRequest {
  /** Recommended center (default: server picks fresh coarse cell at server). */
  lat?: number;
  lng?: number;
  /** Seconds until the zone cell expires (default 30 min). */
  ttlSeconds?: number;
}

export interface GhostZone {
  cellId: string;
  center: { lat: number; lng: number };
  createdAt: number;
  expiresAt: number;
}

export interface GhostZoneResponse {
  zone: GhostZone;
  /** Sessions currently presenting this cell. */
  activeSessions: number;
}

export interface GhostZoneListResponse {
  zones: GhostZone[];
  totalMembers?: number;
}

export interface BlockRequest {
  sessionId: string;
  roomId?: string;
  reason?: string;
}

export interface BlockResponse {
  ok: boolean;
  /** True when the counterpart also blocked (mutual silence). */
  mutual: boolean;
}

export interface ReportRequest {
  sessionId: string;
  roomId?: string;
  category?: string;
  note?: string;
}

export interface ReportResponse {
  ok: boolean;
  /** True when the report count hit the cap and a review flag was set. */
  escalated?: boolean;
}

export interface CreateQrResponse {
  code: string;
  expiresAt: number;
}

export interface RedeemQrRequest {
  code: string;
}

export interface RedeemQrResponse {
  ok: boolean;
  roomId?: string;
  partner?: PartnerInfo;
}

export interface ConnectRequest {
  sessionId: string;
}

export interface ConnectResponse {
  ok: boolean;
  roomId?: string;
  partner?: PartnerInfo;
}

export interface CreateInviteResponse {
  /** Empty slug/url when rate-limited or the custom slug is taken. */
  slug: string;
  url: string;
  expiresAt: number;
}

export interface JoinInviteResponse {
  ok: boolean;
  roomId?: string;
  partner?: PartnerInfo;
}

export interface StatusSnapshot {
  activeSessions: number;
  activeRooms: number;
  queued: number;
  uptimeSeconds: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  redis: 'up' | 'down' | 'memory-fallback';
  version: string;
  uptimeSeconds: number;
}

export interface ErrorResponse {
  error: { code: string; message: string; hint?: string };
}

export const MAX_ALIAS_LENGTH = 32;
export const MAX_REPORT_NOTE_LENGTH = 500;
export const MAX_CHAT_DATA_LENGTH = 6_000;
export const DEFAULT_SESSION_TTL_SECONDS = 4 * 60 * 60;
export const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_ROOM_TTL_SECONDS = 1 * 60 * 60;
export const MAX_ROOM_TTL_SECONDS = 24 * 60 * 60;
export const QR_TTL_SECONDS = 5 * 60;
export const GHOST_ZONE_TTL_SECONDS = 30 * 60;
export const MAX_ZONE_TTL_SECONDS = 4 * 60 * 60;
export const MAX_INVITES_PER_SESSION = 30;
export const MAX_REPORTS_PER_SESSION = 20;
export const MAX_NEARBY_RESULTS = 50;
