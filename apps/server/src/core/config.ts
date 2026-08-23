import { randomBytes } from 'node:crypto';
import { Global, Logger, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface AppRuntimeConfig {
  serverPort: number;
  redisUrl: string | null;
  sessionJwtSecret: string;
  sessionJwtTtlSeconds: number;
  partnerControlSecret: string;
  defaultSessionTtlSeconds: number;
  maxSessionTtlSeconds: number;
  defaultRoomTtlSeconds: number;
  maxRoomTtlSeconds: number;
  qrTtlSeconds: number;
  maxInvitesPerSession: number;
  maxReportsPerSession: number;
  metricsToken: string | null;
  allowedOrigins: string[];
  outboundLatencyMs: number;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

export function loadRuntimeConfig(): AppRuntimeConfig {
  const rawSecret = process.env.SESSION_JWT_SECRET;
  if (!rawSecret || rawSecret.length < 32) {
    Logger.warn(
      'SESSION_JWT_SECRET not set (or <32 chars) — generating a random per-boot secret. ' +
        'Sessions will be invalidated whenever the server restarts.',
    );
  }
  const secretSource = rawSecret && rawSecret.length >= 32 ? rawSecret : randomHex(64);

  return {
    // PaaS detail: Render/Railway/Heroku inject $PORT; explicit SERVER_PORT wins.
    serverPort: envInt('SERVER_PORT', envInt('PORT', 3000)),
    redisUrl: process.env.REDIS_URL || null,
    sessionJwtSecret: secretSource,
    sessionJwtTtlSeconds: envInt('SESSION_JWT_TTL_SECONDS', 4 * 60 * 60),
    partnerControlSecret: process.env.PARTNER_CONTROL_SECRET || randomHex(48),
    defaultSessionTtlSeconds: envInt('DEFAULT_SESSION_TTL_SECONDS', 4 * 60 * 60),
    maxSessionTtlSeconds: envInt('MAX_SESSION_TTL_SECONDS', 24 * 60 * 60),
    defaultRoomTtlSeconds: envInt('DEFAULT_ROOM_TTL_SECONDS', 60 * 60),
    maxRoomTtlSeconds: envInt('MAX_ROOM_TTL_SECONDS', 24 * 60 * 60),
    qrTtlSeconds: envInt('QR_TTL_SECONDS', 5 * 60),
    maxInvitesPerSession: envInt('MAX_INVITES_PER_SESSION', 30),
    maxReportsPerSession: envInt('MAX_REPORTS_PER_SESSION', 20),
    metricsToken:
      process.env.METRICS_TOKEN && process.env.METRICS_TOKEN.length >= 16
        ? process.env.METRICS_TOKEN
        : null,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    outboundLatencyMs: Math.min(5000, envInt('OUTBOUND_LATENCY_MS', 0)),
  };
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

@Global()
@Module({
  providers: [
    {
      provide: 'APP_CONFIG',
      useFactory: (): AppRuntimeConfig => loadRuntimeConfig(),
    },
    RedisService,
  ],
  exports: ['APP_CONFIG', RedisService],
})
export class ConfigModule {}
