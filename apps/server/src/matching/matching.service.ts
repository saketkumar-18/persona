import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../core/redis.service';
import { SessionService } from '../sessions/session.service';
import { RoomService } from '../rooms/room.service';
import { MetricsService } from '../core/metrics.service';

export interface MatchResult {
  roomId?: string;
  partnerId?: string;
  queued?: boolean;
  position?: number;
}

/**
 * Anonymous pairing engine.
 *
 * Two modes:
 *  - global: FIFO queue of waiting session ids; a new arrival instantly pairs
 *    with the oldest available entry (oldest-first fairness).
 *  - zone: a ghost-zone coarsened cell acts as its own queue; only sessions in
 *    the same cell can pair (event mode).
 *
 * Blocked pairs are skipped via the blocklist service. Queue entries are
 * session ids only — no payloads, no profiles.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly rooms: RoomService,
    private readonly metrics: MetricsService,
  ) {}

  private globalQueueKey = 'match:queue:global';

  private zoneQueueKey(cellId: string): string {
    return `match:queue:zone:${cellId}`;
  }

  /** Try to pair `me` now; otherwise enqueue. `zoneCell` = null for global. */
  async findPartner(
    me: { id: string; alias: string; emoji: string },
    zoneCell: string | null,
    blockedIds: Set<string>,
  ): Promise<MatchResult> {
    const queueKey = zoneCell ? this.zoneQueueKey(zoneCell) : this.globalQueueKey;

    // 1) Try to pop a compatible candidate from the queue.
    const candidateId = await this.popCompatible(queueKey, me.id, blockedIds);
    if (candidateId) {
      const candidate = await this.sessions.getSession(candidateId);
      if (candidate && candidate.status !== 'in_chat') {
        const room = await this.rooms.createRoom([me.id, candidateId], zoneCell ? 'zone' : 'global');
        await this.sessions.setStatus(me.id, 'in_chat');
        await this.sessions.setStatus(candidateId, 'in_chat');
        this.metrics.recordMatch(zoneCell ? 'zone' : 'global');
        await this.syncQueueMetrics();
        return { roomId: room.id, partnerId: candidateId };
      }
      // candidate vanished/expired — fall through and enqueue myself.
    }

    // 2) Enqueue myself, remove any stale self-entry first.
    await this.redis.lrem(queueKey, me.id);
    await this.redis.rpush(queueKey, me.id);
    const position = await this.redis.llen(queueKey);
    await this.sessions.setStatus(me.id, 'matching');
    await this.syncQueueMetrics();
    return { queued: true, position };
  }

  private async popCompatible(queueKey: string, myId: string, blockedIds: Set<string>): Promise<string | null> {
    // Simple LPOP loop with blocklist/expiry filtering; queue is small by design.
    for (let i = 0; i < 8; i += 1) {
      const id = await this.redis.lpop(queueKey);
      if (!id) return null;
      if (id === myId) continue;
      if (blockedIds.has(id)) {
        continue;
      }
      const s = await this.sessions.getSession(id);
      if (!s || s.status === 'in_chat') continue;
      return id;
    }
    return null;
  }

  async leaveQueue(meId: string, zoneCell?: string | null): Promise<void> {
    const keys = [this.globalQueueKey];
    if (zoneCell) keys.push(this.zoneQueueKey(zoneCell));
    for (const k of keys) await this.redis.lrem(k, meId);
    await this.sessions.setStatus(meId, 'idle');
    await this.syncQueueMetrics();
  }

  /** Remove a departed session from any queue it still sits in. */
  async removeFromAllQueues(sessionId: string): Promise<void> {
    await this.redis.lrem(this.globalQueueKey, sessionId);
    const zones = await this.redis.smembers('zones:list');
    for (const z of zones) await this.redis.lrem(this.zoneQueueKey(z), sessionId);
  }

  private async syncQueueMetrics(): Promise<void> {
    const globalLen = await this.redis.llen(this.globalQueueKey);
    this.metrics.setQueueSize('global', globalLen);
  }
}
