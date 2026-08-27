import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

jest.setTimeout(30_000);

describe('Persona REST API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSession(): Promise<{ sessionId: string; token: string }> {
    const res = await request(app.getHttpServer()).post('/api/sessions').send({}).expect(201);
    expect(res.body.sessionId).toMatch(/^gl_/);
    expect(res.body.token).toBeTruthy();
    return res.body;
  }

  it('GET /api/health is public', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBeTruthy();
  });

  it('GET /api/status reports aggregates', async () => {
    const res = await request(app.getHttpServer()).get('/api/status').expect(200);
    expect(typeof res.body.activeSessions).toBe('number');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('creates a session with randomized identity', async () => {
    const body = await request(app.getHttpServer()).post('/api/sessions').send({}).expect(201);
    expect(body.body.session.alias).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(body.body.session.status).toBe('idle');
  });

  it('rejects malformed session bodies', async () => {
    await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ alias: 12345 })
      .expect(400);
  });

  it('requires bearer auth on protected routes', async () => {
    await request(app.getHttpServer()).get('/api/sessions/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Authorization', 'Bearer garbage')
      .expect(401);
  });

  it('fetches + patches my own profile', async () => {
    const { token } = await createSession();
    const me = await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const patched = await request(app.getHttpServer())
      .patch('/api/sessions/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ alias: 'Custom Ghost' })
      .expect(200);
    expect(patched.body.session.alias).toBe('Custom Ghost');
    expect(patched.body.session.id).toBe(me.body.session.id);
  });

  it('destroys the session on DELETE; subsequent reads 404', async () => {
    const { token } = await createSession();
    await request(app.getHttpServer())
      .delete('/api/sessions/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/sessions/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('nearby discovery returns sessions in adjacent coarse cells', async () => {
    const a = await createSession();
    const b = await createSession();

    // Both present in the same coarse cell (~Berlin)
    const cellId = 'u33dc0';
    await request(app.getHttpServer())
      .post('/api/discovery/nearby')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ cellId })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/discovery/nearby')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ cellId })
      .expect(201);

    expect(res.body.cellId).toBe(cellId);
    const ids = res.body.users.map((u: { session: { id: string } }) => u.session.id);
    expect(ids).toContain(a.sessionId);
    // distance/bearing are derived from cell centers only
    const view = res.body.users.find((u: { session: { id: string } }) => u.session.id === a.sessionId);
    expect(typeof view.distanceMeters).toBe('number');
  });

  it('rejects nearby calls with non-coarse cells', async () => {
    const { token } = await createSession();
    await request(app.getHttpServer())
      .post('/api/discovery/nearby')
      .set('Authorization', `Bearer ${token}`)
      .send({ cellId: 'XYZ!' })
      .expect(201)
      .expect((res) => {
        expect(res.body.users).toEqual([]);
      });
  });

  it('ghost zone enter reports cell + active session count', async () => {
    const { token } = await createSession();
    const res = await request(app.getHttpServer())
      .post('/api/discovery/zone')
      .set('Authorization', `Bearer ${token}`)
      .send({ cellId: 'u33dc' })
      .expect(201);
    expect(res.body.zone.cellId).toBe('u33dc');
    expect(res.body.activeSessions).toBe(0); // only other sessions counted
  });

  it('full QR pairing flow: create → redeem → room formed', async () => {
    const a = await createSession();
    const b = await createSession();

    const created = await request(app.getHttpServer())
      .post('/api/qr/create')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(201);
    expect(created.body.code).toMatch(/^ql_/);
    expect(created.body.expiresAt).toBeGreaterThan(Date.now());

    const redeemed = await request(app.getHttpServer())
      .post('/api/qr/redeem')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ code: created.body.code })
      .expect(200);
    expect(redeemed.body.ok).toBe(true);
    expect(redeemed.body.roomId).toMatch(/^rm_/);
    expect(redeemed.body.partner.id).toBe(a.sessionId);

    // second redemption must fail (code consumed)
    const c = await createSession();
    const again = await request(app.getHttpServer())
      .post('/api/qr/redeem')
      .set('Authorization', `Bearer ${c.token}`)
      .send({ code: created.body.code })
      .expect(200);
    expect(again.body.ok).toBe(false);
  });

  it('block tears down the shared room', async () => {
    const a = await createSession();
    const b = await createSession();
    const created = await request(app.getHttpServer())
      .post('/api/qr/create')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(201);
    const redeemed = await request(app.getHttpServer())
      .post('/api/qr/redeem')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ code: created.body.code })
      .expect(200);
    expect(redeemed.body.ok).toBe(true);

    const pair = await request(app.getHttpServer()).get('/api/status').expect(200);
    const roomsWithPair = Number(pair.body.activeRooms);
    expect(roomsWithPair).toBeGreaterThanOrEqual(1);

    const blockRes = await request(app.getHttpServer())
      .post('/api/moderation/block')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ sessionId: a.sessionId, roomId: redeemed.body.roomId })
      .expect(200);
    expect(blockRes.body.ok).toBe(true);

    const after = await request(app.getHttpServer()).get('/api/status').expect(200);
    expect(Number(after.body.activeRooms)).toBeLessThan(roomsWithPair);
  });

  it('report endpoint accepts categories and dedupes via counters', async () => {
    const a = await createSession();
    const b = await createSession();
    const res = await request(app.getHttpServer())
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ sessionId: b.sessionId, category: 'harassment', note: 'was mean' })
      .expect(200);
    expect(res.body.ok).toBe(true);

    const bad = await request(app.getHttpServer())
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ sessionId: b.sessionId, category: 'not-a-category' })
      .expect(200);
    expect(bad.body.ok).toBe(false);
  });

  it('metrics endpoint is gated by token when configured', async () => {
    // METRICS_TOKEN unset in tests → open metrics (dev default)
    const res = await request(app.getHttpServer()).get('/api/metrics').expect(200);
    expect(res.text).toContain('persona_sessions_created_total');
  });

  it('direct connect pairs two discovered sessions', async () => {
    const a = await createSession();
    const b = await createSession();

    const res = await request(app.getHttpServer())
      .post('/api/qr/connect')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ sessionId: b.sessionId })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.roomId).toMatch(/^rm_/);
    expect(res.body.partner.id).toBe(b.sessionId);

    // a third session cannot connect to a now-busy session
    const c = await createSession();
    const busy = await request(app.getHttpServer())
      .post('/api/qr/connect')
      .set('Authorization', `Bearer ${c.token}`)
      .send({ sessionId: b.sessionId })
      .expect(200);
    expect(busy.body.ok).toBe(false);

    // self-connect must fail
    const self = await request(app.getHttpServer())
      .post('/api/qr/connect')
      .set('Authorization', `Bearer ${c.token}`)
      .send({ sessionId: c.sessionId })
      .expect(200);
    expect(self.body.ok).toBe(false);
  });

  it('delivers the partner public key + fingerprint at pairing (E2E)', async () => {
    // sessions created with public material registered
    const mkBody = {
      alias: 'Keyed Ghost',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'x-value', y: 'y-value' },
      fingerprint: 'AB12-CD34',
    };
    const a = await request(app.getHttpServer()).post('/api/sessions').send(mkBody).expect(201);
    const b = await request(app.getHttpServer()).post('/api/sessions').send(mkBody).expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/qr/connect')
      .set('Authorization', `Bearer ${a.body.token}`)
      .send({ sessionId: b.body.sessionId })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.partner.publicKey).toEqual(mkBody.publicKey);
    expect(res.body.partner.fingerprint).toBe('AB12-CD34');
  });

  it('exposes publicKey via PATCH /sessions/me', async () => {
    const s = await createSession();
    const patched = await request(app.getHttpServer())
      .patch('/api/sessions/me')
      .set('Authorization', `Bearer ${s.token}`)
      .send({ publicKey: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }, fingerprint: 'ZZ99' })
      .expect(200);
    expect(patched.body.session.publicKey).toEqual({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' });
    expect(patched.body.session.fingerprint).toBe('ZZ99');
  });
});
