import { RedisService } from '../../src/core/redis.service';
import { MetricsService } from '../../src/core/metrics.service';
import { SessionService } from '../../src/sessions/session.service';
import { ModerationService } from '../../src/moderation/moderation.service';
import type { AppRuntimeConfig } from '../../src/core/config';

const config: AppRuntimeConfig = {
  serverPort: 3000,
  redisUrl: null,
  sessionJwtSecret: 'x'.repeat(64),
  sessionJwtTtlSeconds: 3600,
  partnerControlSecret: 'y'.repeat(64),
  defaultSessionTtlSeconds: 4 * 3600,
  maxSessionTtlSeconds: 24 * 3600,
  defaultRoomTtlSeconds: 3600,
  maxRoomTtlSeconds: 24 * 3600,
  qrTtlSeconds: 300,
  maxInvitesPerSession: 30,
  maxReportsPerSession: 3,
  metricsToken: null,
  allowedOrigins: [],
  outboundLatencyMs: 0,
};

async function makeModeration() {
  const redis = new RedisService();
  await redis.connect(null);
  const metrics = new MetricsService();
  const sessions = new SessionService(redis, metrics, config);
  const moderation = new ModerationService(redis, sessions, config, metrics);
  return { redis, sessions, moderation };
}

describe('ModerationService', () => {
  it('records one-directional blocks', async () => {
    const { moderation } = await makeModeration();
    const result = await moderation.block('gl_a', 'gl_b');
    expect(result).toEqual({ ok: true, mutual: false });
    expect(await moderation.isBlocked('gl_a', 'gl_b')).toBe(true);
    expect(await moderation.isBlocked('gl_b', 'gl_a')).toBe(false);
  });

  it('detects mutual blocks', async () => {
    const { moderation } = await makeModeration();
    await moderation.block('gl_b', 'gl_a');
    const result = await moderation.block('gl_a', 'gl_b');
    expect(result.mutual).toBe(true);
  });

  it('blockedIds returns the full blocklist', async () => {
    const { moderation } = await makeModeration();
    await moderation.block('gl_a', 'gl_b');
    await moderation.block('gl_a', 'gl_c');
    expect(await moderation.blockedIds('gl_a')).toEqual(new Set(['gl_b', 'gl_c']));
  });

  it('reports count up and escalate at the configured cap', async () => {
    const { moderation } = await makeModeration();
    expect((await moderation.report('gl_r', 'gl_s1', 'spam')).escalated).toBe(false);
    expect((await moderation.report('gl_r', 'gl_s2', 'spam')).escalated).toBe(false);
    expect((await moderation.report('gl_r', 'gl_s3', 'spam')).escalated).toBe(true);
  });

  it('report notes are stored only as hashes', async () => {
    const { redis, moderation } = await makeModeration();
    await moderation.report('gl_r', 'gl_s1', 'harassment', 'he said X');
    const keys = await redis.get('reports:gl_r');
    expect(keys).toBe('1');
    // raw note must never appear in the store
    const { mem } = redis as unknown as { mem: Map<string, { value: unknown }> };
    for (const [k, v] of mem.entries()) {
      expect(String(v.value)).not.toContain('he said X');
      expect(k.includes('reportnote:') ? k : 'ok').not.toContain('X');
    }
  });

  it('releaseAll clears the blocklist', async () => {
    const { moderation } = await makeModeration();
    await moderation.block('gl_a', 'gl_b');
    await moderation.releaseAll('gl_a');
    expect(await moderation.isBlocked('gl_a', 'gl_b')).toBe(false);
  });
});
