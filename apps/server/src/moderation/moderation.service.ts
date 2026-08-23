import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sanitizeReportNote } from '@ghostlink/shared';
import { RedisService } from '../core/redis.service';
import { SessionService } from '../sessions/session.service';
import { AppRuntimeConfig } from '../core/config';
import { MetricsService } from '../core/metrics.service';

/**
 * Privacy-preserving moderation.
 *
 * Blocks: per-session blocklists stored in Redis only; expiring with the
 * sessions themselves.
 *
 * Reports: counters + rolling flag records only. Report notes are stored
 * SHA-256-hashed and counters expire within 24h. No PII, no archive.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    @Inject('APP_CONFIG') private readonly config: AppRuntimeConfig,
    private readonly metrics: MetricsService,
  ) {}

  private blockKey(sessionId: string): string {
    return `blocked:${sessionId}`;
  }

  private reportCountKey(sessionId: string): string {
    return `reports:${sessionId}`;
  }

  /** Block another session. Returns true if the block is mutual. */
  async block(blockerId: string, blockedId: string): Promise<{ ok: boolean; mutual: boolean }> {
    const reverseBlocks = await this.redis.smembers(this.blockKey(blockedId));
    const mutual = reverseBlocks.includes(blockerId);
    await this.redis.sadd(this.blockKey(blockerId), blockedId);
    await this.redis.expire(this.blockKey(blockerId), 24 * 3600);
    this.logger.debug(`block recorded: ${blockerId} -> ${blockedId} (mutual=${mutual ? 'y' : 'n'})`);
    return { ok: true, mutual };
  }

  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const list = await this.redis.smembers(this.blockKey(blockerId));
    return list.includes(blockedId);
  }

  async blockedIds(sessionId: string): Promise<Set<string>> {
    return new Set(await this.redis.smembers(this.blockKey(sessionId)));
  }

  async releaseAll(sessionId: string): Promise<void> {
    await this.redis.del(this.blockKey(sessionId));
  }

  /** Record an abuse report; escalate if the reporter hits the cap. */
  async report(reporterId: string, subjectId: string, category: string, note?: string): Promise<{ ok: boolean; escalated: boolean }> {
    const sanitized = sanitizeReportNote(note, '');
    const count = await this.redis.incr(this.reportCountKey(reporterId), 24 * 3600);
    const escalated = count >= this.config.maxReportsPerSession;
    if (escalated) {
      // Flag the reporter session for review; flag expires with the session.
      await this.redis.set(`flag:${reporterId}`, JSON.stringify({ category, n: count, at: Date.now() }), 24 * 3600);
    }
    if (sanitized) {
      // Store only a hash so report content never survives in clear text.
      const digest = createHash('sha256').update(sanitized).digest('hex');
      await this.redis.set(`reportnote:${reporterId}:${digest}`, digest, 3600);
    }
    void this.sessions; // kept for future per-session sanctions
    this.metrics.recordReport(category || 'other');
    this.logger.debug(`report: ${reporterId} -> ${subjectId} cat=${category} escalated=${escalated}`);
    return { ok: true, escalated };
  }
}
