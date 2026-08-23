import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  generateSessionId,
  randomAlias,
  randomEmoji,
  GHOST_EMOJIS,
  sanitizeAlias,
} from '@ghostlink/shared';
import { RedisService } from '../core/redis.service';
import { MetricsService } from '../core/metrics.service';
import { AppRuntimeConfig } from '../core/config';

export interface StoredSession {
  id: string;
  alias: string;
  emoji: string;
  status: 'idle' | 'matching' | 'in_chat' | 'offline';
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  /** Geohash cell (coarsened) — present only when GPS discovery was enabled. */
  presenceCell?: string;
  travel?: boolean;
  /** Non-reduced geohash prefix for address disclosure; set at same time as presenceCell. */
  presenceCellCoarse?: string;
  /** ECDH P-256 PUBLIC key (JWK) — public material only, delivered to partners at pairing. */
  publicKey?: JsonWebKey;
  /** Short fingerprint of the public key (safety code shown in chat UI). */
  fingerprint?: string;
}

/**
 * Anonymous session store. Sessions are the ONLY identity concept: they exist
 * only in Redis (or in-memory fallback) and expire automatically. When a
 * session expires it is gone forever — no history, no backups.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    @Inject('APP_CONFIG') private readonly config: AppRuntimeConfig,
  ) {}

  private key(id: string): string {
    return `sess:${id}`;
  }

  /** Create a fresh anonymous session with random alias/emoji. */
  async createSession(
    opts: { alias?: string; emoji?: string; ttlSeconds?: number; publicKey?: JsonWebKey; fingerprint?: string } = {},
  ): Promise<StoredSession> {
    const id = generateSessionId();
    const now = Date.now();
    const ttl = Math.min(Math.max(opts.ttlSeconds ?? this.config.defaultSessionTtlSeconds, 60), this.config.maxSessionTtlSeconds);
    const alias = sanitizeAlias(opts.alias, randomAlias());
    const emoji = opts.emoji && GHOST_EMOJIS.includes(opts.emoji as (typeof GHOST_EMOJIS)[number]) ? opts.emoji : randomEmoji();

    const session: StoredSession = {
      id,
      alias,
      emoji,
      status: 'offline',
      createdAt: now,
      expiresAt: now + ttl * 1000,
      publicKey: opts.publicKey,
      fingerprint: opts.fingerprint,
    };
    await this.save(session, ttl);
    await this.redis.sadd('sessions:active', id);
    await this.redis.expire('sessions:active', this.config.maxSessionTtlSeconds);
    this.metrics.recordSessionCreated();
    this.logger.debug(`Session created: ${id} (alias="${alias}", ttl=${ttl}s)`);
    return session;
  }

  async getSession(id: string): Promise<StoredSession | null> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredSession;
      if (parsed.expiresAt <= Date.now()) {
        await this.deleteSession(id);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async save(session: StoredSession, ttlSeconds?: number): Promise<void> {
    const remaining = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
    await this.redis.set(this.key(session.id), JSON.stringify(session), ttlSeconds ?? remaining);
  }

  async update(
    patch: Partial<Pick<StoredSession, 'alias' | 'emoji' | 'status' | 'presenceCell' | 'presenceCellCoarse' | 'travel' | 'publicKey' | 'fingerprint'>>,
    id: string,
  ): Promise<StoredSession | null> {
    const session = await this.getSession(id);
    if (!session) return null;
    if (patch.alias !== undefined) session.alias = sanitizeAlias(patch.alias, session.alias);
    if (patch.emoji !== undefined && GHOST_EMOJIS.includes(patch.emoji as (typeof GHOST_EMOJIS)[number])) session.emoji = patch.emoji;
    if (patch.status !== undefined) session.status = patch.status;
    if (patch.presenceCell !== undefined) session.presenceCell = patch.presenceCell;
    if (patch.presenceCellCoarse !== undefined) session.presenceCellCoarse = patch.presenceCellCoarse;
    if (patch.travel !== undefined) session.travel = patch.travel;
    if (patch.publicKey !== undefined) session.publicKey = patch.publicKey;
    if (patch.fingerprint !== undefined) session.fingerprint = patch.fingerprint;
    await this.save(session);
    return session;
  }

  async setStatus(id: string, status: StoredSession['status']): Promise<StoredSession | null> {
    return this.update({ status }, id);
  }

  async setPresence(id: string, cell: string, coarse: string, travel: boolean): Promise<StoredSession | null> {
    return this.update({ presenceCell: cell, presenceCellCoarse: coarse, travel }, id);
  }

  async clearPresence(id: string): Promise<StoredSession | null> {
    const session = await this.getSession(id);
    if (!session) return null;
    delete session.presenceCell;
    delete session.presenceCellCoarse;
    session.travel = false;
    await this.save(session);
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    await this.redis.del(this.key(id));
    await this.redis.srem('sessions:active', id);
    // best-effort cleanup of auxiliary keys
    await this.redis.del(`blocked:${id}`);
    await this.redis.del(`reports:${id}`);
    this.logger.debug(`Session deleted: ${id}`);
  }

  async countActive(): Promise<number> {
    const ids = await this.redis.smembers('sessions:active');
    let n = 0;
    for (const id of ids) {
      const s = await this.getSession(id);
      if (s) n += 1;
    }
    return n;
  }

  /** Remove expired entries from the active set. */
  async sweepExpired(): Promise<number> {
    const ids = await this.redis.smembers('sessions:active');
    let removed = 0;
    for (const id of ids) {
      const s = await this.getSession(id);
      if (!s) {
        await this.redis.srem('sessions:active', id);
        removed += 1;
      }
    }
    return removed;
  }
}
