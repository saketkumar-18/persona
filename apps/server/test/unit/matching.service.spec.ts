import { RedisService } from '../../src/core/redis.service';
import { MetricsService } from '../../src/core/metrics.service';
import { SessionService } from '../../src/sessions/session.service';
import { RoomService } from '../../src/rooms/room.service';
import { MatchingService } from '../../src/matching/matching.service';
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

async function makeMatcher() {
  const redis = new RedisService();
  await redis.connect(null);
  const metrics = new MetricsService();
  const sessions = new SessionService(redis, metrics, config);
  const rooms = new RoomService(redis, config);
  const matching = new MatchingService(redis, sessions, rooms, metrics);
  return { redis, sessions, rooms, matching };
}

describe('MatchingService', () => {
  it('enqueues the first arriver and pairs the second instantly', async () => {
    const { sessions, matching } = await makeMatcher();
    const a = await sessions.createSession({});
    const b = await sessions.createSession({});

    const first = await matching.findPartner({ id: a.id, alias: a.alias, emoji: a.emoji }, null, new Set());
    expect(first.queued).toBe(true);
    expect(first.position).toBe(1);

    const second = await matching.findPartner({ id: b.id, alias: b.alias, emoji: b.emoji }, null, new Set());
    expect(second.roomId).toMatch(/^rm_/);
    expect(second.partnerId).toBe(a.id);

    expect((await sessions.getSession(a.id))?.status).toBe('in_chat');
    expect((await sessions.getSession(b.id))?.status).toBe('in_chat');
  });

  it('never pairs me with someone I blocked', async () => {
    const { sessions, matching } = await makeMatcher();
    const a = await sessions.createSession({});
    const b = await sessions.createSession({});

    await matching.findPartner({ id: a.id, alias: a.alias, emoji: a.emoji }, null, new Set());
    const result = await matching.findPartner(
      { id: b.id, alias: b.alias, emoji: b.emoji },
      null,
      new Set([a.id]),
    );
    expect(result.queued).toBe(true);
    expect(result.roomId).toBeUndefined();
  });

  it('leaveQueue releases me back to idle', async () => {
    const { sessions, matching } = await makeMatcher();
    const a = await sessions.createSession({});
    await matching.findPartner({ id: a.id, alias: a.alias, emoji: a.emoji }, null, new Set());
    await matching.leaveQueue(a.id);
    expect((await sessions.getSession(a.id))?.status).toBe('idle');
  });

  it('zone matching only pairs within the same zone cell', async () => {
    const { sessions, matching } = await makeMatcher();
    const a = await sessions.createSession({});
    const b = await sessions.createSession({});

    const first = await matching.findPartner(
      { id: a.id, alias: a.alias, emoji: a.emoji },
      '9q8yyk',
      new Set(),
    );
    expect(first.queued).toBe(true);

    // b queues into a DIFFERENT zone → must not pair with a
    const different = await matching.findPartner(
      { id: b.id, alias: b.alias, emoji: b.emoji },
      '9q8yyt',
      new Set(),
    );
    expect(different.queued).toBe(true);
    expect(different.roomId).toBeUndefined();
  });

  it('skips stale queue entries for expired sessions', async () => {
    const { sessions, matching } = await makeMatcher();
    const a = await sessions.createSession({});
    const b = await sessions.createSession({});
    await matching.findPartner({ id: a.id, alias: a.alias, emoji: a.emoji }, null, new Set());
    await sessions.deleteSession(a.id); // a vanishes while queued

    const second = await matching.findPartner({ id: b.id, alias: b.alias, emoji: b.emoji }, null, new Set());
    expect(second.roomId).toBeUndefined();
    expect(second.queued).toBe(true);
  });
});
