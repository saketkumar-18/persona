/**
 * GhostLink realtime protocol (Socket.IO default namespace).
 *
 * Plane split:
 *  - Control plane (REST): session CRUD, nearby discovery, QR pair-exchange,
 *    ghost zones, block/report, health/status. Easy to rate-limit + test.
 *  - Realtime plane (Socket.IO): matching, room join, ciphertext chat relay,
 *    typing, presence heartbeat, room leave/expire notifications.
 *
 * Chat payload = opaque base64url JSON envelope produced client-side with a
 * per-room AES-256-GCM key derived from an ephemeral ECDH key exchange
 * (see crypto.ts in @ghostlink/shared). The server relays ciphertext only
 * and never derives or stores room keys.
 */

import type { MatchSource, PartnerInfo } from './types';

/** Error codes shared by REST error bodies and WS error frames. */
export const ERROR_CODES = {
  INVALID_TOKEN: 'INVALID_TOKEN',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  BLOCKED: 'BLOCKED',
  ALREADY_BLOCKED: 'ALREADY_BLOCKED',
  REPORT_LIMIT: 'REPORT_LIMIT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  MALFORMED: 'MALFORMED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorFrame {
  code: ErrorCode;
  message: string;
  hint?: string;
  fatal?: boolean;
}

export interface RoomLeaveReasons {
  LEFT: 'left';
  JOINED: 'joined';
  BLOCKED: 'blocked';
  EXPIRED: 'expired';
  PARTNER_LEFT: 'partner_left';
  SWITCHED: 'switched';
}

export type RoomLeaveReason =
  | 'left'
  | 'joined'
  | 'blocked'
  | 'expired'
  | 'partner_left'
  | 'switched';

export type ClientEvents = {
  /** Start matching. Ack: {queued:true, position} or {matched:true, roomId, partner}. */
  'match:start': (
    payload: {
      source: MatchSource;
      /** Ghost-zone filter — if provided, partner must share this coarse cell. */
      zoneCell?: string;
    },
    cb?: (ack: unknown) => void,
  ) => void;
  'match:cancel': (
    _payload: Record<string, never>,
    cb?: (ack: unknown) => void,
  ) => void;
  /** Explicit room leave (also clears session status). */
  'room:leave': (payload: { roomId?: string }, cb?: (ack: unknown) => void) => void;
  /** Ciphertext frame — opaque base64url JSON envelope. */
  'chat:message': (
    payload: { roomId: string; data: string },
    cb?: (ack: unknown) => void,
  ) => void;
  'chat:typing': (payload: { roomId: string; isTyping: boolean }) => void;
  /** Presence heartbeat while GPS/local discovery is active. */
  'presence:tick': (payload: { cellId: string; travel?: boolean }) => void;
  /** Mark presence cleared (travel mode off / GPS revoked). */
  'presence:clear': (_payload: Record<string, never>) => void;
};

export type ServerEvents = {
  'match:queued': (payload: { position: number }) => void;
  'match:found': (payload: { roomId: string; partner: PartnerInfo }) => void;
  'room:left': (payload: { roomId: string; reason: RoomLeaveReason }) => void;
  'room:expired': (payload: { roomId: string }) => void;
  'chat:message': (payload: { roomId: string; data: string; receivedAt: number }) => void;
  'chat:typing': (payload: { roomId: string; isTyping: boolean }) => void;
  'presence:update': (payload: { cellId: string; travel?: boolean }) => void;
  /** Partner-side channel update delivered at pairing time (echo of room:joined). */
  'pair:formed': (payload: { roomId: string; partner: PartnerInfo }) => void;
  /** Generic protocol error frame; see error.code. */
  error: (payload: ErrorFrame) => void;
  /** Housekeeping notice emitted to both ends during moderation actions. */
  'moderation:notice': (payload: { message: string }) => void;
};

export interface MatchStartAck {
  ok: boolean;
  matched?: boolean;
  queued?: boolean;
  roomId?: string;
  partner?: PartnerInfo;
  position?: number;
  error?: ErrorCode;
}

export interface PairAck {
  ok: boolean;
  roomId?: string;
  partner?: PartnerInfo | null;
  error?: ErrorCode;
}
