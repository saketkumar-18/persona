import { Injectable } from '@nestjs/common';
import { decodeGeohash, adjacentCells, haversineMeters, bearingDeg } from '@ghostlink/shared';
import { RedisService } from '../core/redis.service';
import { SessionService } from '../sessions/session.service';

export interface NearUserView {
  id: string;
  alias: string;
  emoji: string;
  distanceMeters: number;
  bearingDeg: number | null;
  travel?: boolean;
}

/**
 * GPS-based + ghost-zone proximity discovery.
 *
 * Privacy model: clients send ONLY a coarse geohash cell id (coarsening is
 * done on-device). The server indexes sessions by cell, computes distances
 * between cell centers, and never sees raw coordinates. Discovery buckets
 * expire with the session TTL.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
  ) {}

  private bucketKey(cellId: string): string {
    return `presence:cell:${cellId}`;
  }

  async setCellPresence(sessionId: string, cellId: string, travel: boolean, ttlSeconds: number): Promise<void> {
    await this.redis.sadd(this.bucketKey(cellId), sessionId);
    await this.redis.expire(this.bucketKey(cellId), ttlSeconds);
    await this.sessions.setPresence(sessionId, cellId, cellId.slice(0, 5), travel);
  }

  async clearPresence(sessionId: string): Promise<void> {
    const s = await this.sessions.getSession(sessionId);
    if (s?.presenceCell) {
      await this.redis.srem(this.bucketKey(s.presenceCell), sessionId);
    }
    await this.sessions.clearPresence(sessionId);
  }

  /** Sessions in `cellId` or its 8 neighbors, nearest-first, capped at `limit`. */
  async nearby(mySessionId: string, cellId: string, travelModeOnly = false, limit = 30): Promise<NearUserView[]> {
    const me = decodeGeohash(cellId.slice(0, 6));
    const cells = [me.cellId, ...adjacentCells(me.cellId)];
    const out: Array<NearUserView & { d: number }> = [];
    const seen = new Set<string>([mySessionId]);

    for (const c of cells) {
      const ids = await this.redis.smembers(this.bucketKey(c));
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const s = await this.sessions.getSession(id);
        if (!s || !s.presenceCell) continue;
        if (travelModeOnly && !s.travel) continue;
        const theirCell = decodeGeohash(s.presenceCell.slice(0, me.cellId.length));
        out.push({
          id: s.id,
          alias: s.alias,
          emoji: s.emoji,
          distanceMeters: Math.round(haversineMeters(me.center, theirCell.center)),
          bearingDeg: bearingDeg(me.center, theirCell.center),
          travel: s.travel ?? false,
          d: haversineMeters(me.center, theirCell.center),
        });
        if (out.length >= limit * 3) break;
      }
      if (out.length >= limit * 3) break;
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, limit).map(({ d, ...rest }) => rest);
  }

  /** Event mode / ghost zones — all sessions presenting the same coarse cell. */
  async sameCell(cellId: string, mySessionId: string, limit = 100): Promise<string[]> {
    const ids = await this.redis.smembers(this.bucketKey(cellId));
    return ids.filter((id) => id !== mySessionId).slice(0, limit);
  }
}
