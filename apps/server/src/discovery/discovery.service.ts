import { Injectable } from '@nestjs/common';
import { decodeGeohash, adjacentCells, haversineMeters, bearingDeg } from '@persona/shared';
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

/** decodeGeohash that returns null instead of throwing on bad input. */
function safeDecode(cellId: string): ReturnType<typeof decodeGeohash> | null {
  try {
    return decodeGeohash(cellId);
  } catch {
    return null;
  }
}

/** Canonical presence-bucket precision (6-char geohash ≈ 1.2km × 0.6km). */
const PRESENCE_CELL_CHARS = 6;

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
    // Normalize to the same length nearby() uses for bucket lookups so
    // writers and readers always agree on the bucket key.
    const normalized = cellId.slice(0, PRESENCE_CELL_CHARS);
    await this.redis.sadd(this.bucketKey(normalized), sessionId);
    await this.redis.expire(this.bucketKey(normalized), ttlSeconds);
    await this.sessions.setPresence(sessionId, normalized, normalized.slice(0, 5), travel);
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
    // Defense in depth: never let a malformed cell crash the endpoint (500).
    const me = safeDecode(cellId.slice(0, PRESENCE_CELL_CHARS));
    if (!me) return [];
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
        const theirCell = safeDecode(s.presenceCell.slice(0, me.cellId.length));
        if (!theirCell) continue;
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
