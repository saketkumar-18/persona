import { RedisService } from '../../src/core/redis.service';
import { MetricsService } from '../../src/core/metrics.service';
import { SessionService } from '../../src/sessions/session.service';
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
  maxReportsPerSession: 20,
  metricsToken: null,
  allowedOrigins: [],
  outboundLatencyMs: 0,
};

async function makeService(): Promise<{ redis: RedisService; sessions: SessionService }> {
  const redis = new RedisService();
  await redis.connect(null); // in-memory fallback
  const sessions = new SessionService(redis, new MetricsService(), config);
  return { redis, sessions };
}

describe('SessionService', () => {
  it('creates sessions with alias clamping + default emoji', async () => {
    const { sessions } = await makeService();
    const s = await sessions.createSession({ alias: 'a'.repeat(200) });
    expect(s.id).toMatch(/^gl_/);
    expect(s.alias.length).toBeLessThanOrEqual(32);
    expect(s.emoji.length).toBeGreaterThan(0);
    expect(s.expiresAt).toBeGreaterThan(Date.now());
  });

  it('fetches and returns null for unknown ids', async () => {
    const { sessions } = await makeService();
    const s = await sessions.createSession({});
    expect((await sessions.getSession(s.id))?.id).toBe(s.id);
    expect(await sessions.getSession('gl_missing')).toBeNull();
  });

  it('caps ttlSeconds at maxSessionTtlSeconds', async () => {
    const { sessions } = await makeService();
    const s = await sessions.createSession({ ttlSeconds: 10 * 24 * 3600 });
    const lifetime = s.expiresAt - s.createdAt;
    expect(lifetime).toBeLessThanOrEqual(config.maxSessionTtlSeconds * 1000 + 5000);
  });

  it('updates status + presence atomically', async () => {
    const { sessions } = await makeService();
    const s = await sessions.createSession({});
    await sessions.setStatus(s.id, 'idle');
    await sessions.setPresence(s.id, 'u4pruy', 'u4pru', false);
    const updated = await sessions.getSession(s.id);
    expect(updated?.status).toBe('idle');
    expect(updated?.presenceCell).toBe('u4pruy');
    expect(updated?.presenceCellCoarse).toBe('u4pru');
  });

  it('clears presence', async () => {
    const { sessions } = await makeService();
    const s = await sessions.createSession({});
    await sessions.setPresence(s.id, 'u4pruy', 'u4pru', true);
    await sessions.clearPresence(s.id);
    const updated = await sessions.getSession(s.id);
    expect(updated?.presenceCell).toBeUndefined();
  });

  it('deleteSession removes the record from active set', async () => {
    const { redis, sessions } = await makeService();
    const s = await sessions.createSession({});
    await sessions.deleteSession(s.id);
    expect(await sessions.getSession(s.id)).toBeNull();
    expect(await redis.smembers('sessions:active')).not.toContain(s.id);
  });

  it('countActive reflects only live sessions', async () => {
    const { sessions } = await makeService();
    const a = await sessions.createSession({});
    await sessions.createSession({});
    expect(await sessions.countActive()).toBe(2);
    await sessions.deleteSession(a.id);
    expect(await sessions.countActive()).toBe(1);
  });
});
