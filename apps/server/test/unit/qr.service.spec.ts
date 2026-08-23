import { RedisService } from '../../src/core/redis.service';
import { MetricsService } from '../../src/core/metrics.service';
import { SessionService } from '../../src/sessions/session.service';
import { RoomService } from '../../src/rooms/room.service';
import { QrService } from '../../src/qr/qr.service';
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
  maxInvitesPerSession: 3,
  maxReportsPerSession: 20,
  metricsToken: null,
  allowedOrigins: [],
  outboundLatencyMs: 0,
};

async function makeQr() {
  const redis = new RedisService();
  await redis.connect(null);
  const metrics = new MetricsService();
  const sessions = new SessionService(redis, metrics, config);
  const rooms = new RoomService(redis, config);
  const qr = new QrService(redis, sessions, rooms, metrics, config);
  return { redis, sessions, rooms, qr };
}

describe('QrService', () => {
  it('creates a valid single-use pairing code', async () => {
    const { qr, sessions } = await makeQr();
    const a = await sessions.createSession({});
    const { code, expiresAt } = await qr.createCode(a.id);
    expect(code).toMatch(/^ql_/);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('redeeming pairs both sessions into one room', async () => {
    const { qr, sessions, rooms } = await makeQr();
    const a = await sessions.createSession({});
    const b = await sessions.createSession({});
    const { code } = await qr.createCode(a.id);

    const result = await qr.redeemCode(code, b.id);
    expect(result).not.toBeNull();
    expect(result?.partnerId).toBe(a.id);
    const room = await rooms.getRoom(result!.roomId);
    expect(room?.members.sort()).toEqual([a.id, b.id].sort());
    expect((await sessions.getSession(a.id))?.status).toBe('in_chat');
    expect((await sessions.getSession(b.id))?.status).toBe('in_chat');
  });

  it('a code cannot be redeemed twice', async () => {
    const { qr, sessions } = await makeQr();
    const a = await sessions.createSession({});
    const b = await sessions.createSession({});
    const c = await sessions.createSession({});
    const { code } = await qr.createCode(a.id);

    expect(await qr.redeemCode(code, b.id)).not.toBeNull();
    expect(await qr.redeemCode(code, c.id)).toBeNull();
  });

  it('cannot redeem my own code', async () => {
    const { qr, sessions } = await makeQr();
    const a = await sessions.createSession({});
    const { code } = await qr.createCode(a.id);
    expect(await qr.redeemCode(code, a.id)).toBeNull();
  });

  it('enforces the per-session invite limit', async () => {
    const { qr, sessions } = await makeQr();
    const a = await sessions.createSession({});
    await qr.createCode(a.id);
    await qr.createCode(a.id);
    await qr.createCode(a.id);
    await expect(qr.createCode(a.id)).rejects.toThrow('limit_reached');
  });

  it('unknown codes resolve to null', async () => {
    const { qr, sessions } = await makeQr();
    const b = await sessions.createSession({});
    expect(await qr.redeemCode('ql_zzzzzz', b.id)).toBeNull();
  });
});
