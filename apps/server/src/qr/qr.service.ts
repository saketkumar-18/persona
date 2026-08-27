import { Inject, Injectable } from '@nestjs/common';
import { generateQrCode } from '@persona/shared';
import { RedisService } from '../core/redis.service';
import { AppRuntimeConfig } from '../core/config';
import { SessionService } from '../sessions/session.service';
import { RoomService } from '../rooms/room.service';
import { MetricsService } from '../core/metrics.service';

/**
 * QR instant-connect.
 *
 * Flow: session A generates a short pairing code (shown as QR). Session B —
 * physically nearby, scanning A's QR — redeems it. The pairing code is the
 * secret: it is never disclosed except inside the QR payload, expires after
 * `qrTtlSeconds`, and creation is rate-limited per session.
 */
@Injectable()
export class QrService {
  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly rooms: RoomService,
    private readonly metrics: MetricsService,
    @Inject('APP_CONFIG') private readonly config: AppRuntimeConfig,
  ) {}

  private codeKey(code: string): string {
    return `qr:${code}`;
  }

  private countKey(sessionId: string): string {
    return `qr:count:${sessionId}`;
  }

  async createCode(mySessionId: string): Promise<{ code: string; expiresAt: number }> {
    const created = await this.redis.incr(this.countKey(mySessionId), this.config.qrTtlSeconds);
    if (created > this.config.maxInvitesPerSession) {
      throw new Error('limit_reached');
    }
    const code = generateQrCode();
    const expiresAt = Date.now() + this.config.qrTtlSeconds * 1000;
    await this.redis.set(this.codeKey(code), mySessionId, this.config.qrTtlSeconds);
    return { code, expiresAt };
  }

  /** Redeem a scanned code; pairs both sessions into a fresh room. */
  async redeemCode(code: string, redeemerSessionId: string): Promise<{ roomId: string; partnerId: string } | null> {
    const ownerId = await this.redis.get(this.codeKey(code));
    if (!ownerId || ownerId === redeemerSessionId) return null;
    await this.redis.del(this.codeKey(code));
    return this.pairSessions(ownerId, redeemerSessionId);
  }

  /** Direct pairing (nearby "Connect" flow) without a QR code. */
  async connectWith(mySessionId: string, targetSessionId: string): Promise<{ roomId: string; partnerId: string } | null> {
    if (mySessionId === targetSessionId) return null;
    return this.pairSessions(targetSessionId, mySessionId);
  }

  private async pairSessions(ownerId: string, secondId: string): Promise<{ roomId: string; partnerId: string } | null> {
    const owner = await this.sessions.getSession(ownerId);
    const redeemer = await this.sessions.getSession(secondId);
    if (!owner || !redeemer || owner.status === 'in_chat' || redeemer.status === 'in_chat') return null;

    const room = await this.rooms.createRoom([ownerId, secondId], 'qr');
    await this.sessions.setStatus(ownerId, 'in_chat');
    await this.sessions.setStatus(secondId, 'in_chat');
    this.metrics.recordMatch('qr');
    return { roomId: room.id, partnerId: ownerId };
  }
}
