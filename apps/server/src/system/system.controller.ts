import { Controller, Get, Header, Headers, HttpCode, Inject, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponse, StatusSnapshot } from '@ghostlink/shared';
import { RedisService } from '../core/redis.service';
import { SessionService } from '../sessions/session.service';
import { RoomService } from '../rooms/room.service';
import { MetricsService } from '../core/metrics.service';
import { AppRuntimeConfig } from '../core/config';

const APP_VERSION = '1.0.0';

@ApiTags('system')
@Controller()
export class SystemController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly rooms: RoomService,
    private readonly metrics: MetricsService,
    @Inject('APP_CONFIG') private readonly config: AppRuntimeConfig,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness/readiness probe (public)' })
  async health(): Promise<HealthResponse> {
    return {
      status: this.redis.ready ? 'ok' : 'degraded',
      redis: this.redis.isRedis ? 'up' : 'memory-fallback',
      version: APP_VERSION,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  @Get('status')
  @ApiOperation({ summary: 'Live anonymous platform metrics (public, aggregate only)' })
  async status(): Promise<StatusSnapshot> {
    return {
      activeSessions: await this.sessions.countActive(),
      activeRooms: await this.rooms.countActive(),
      queued: 0,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  @HttpCode(200)
  @ApiOperation({ summary: 'Prometheus metrics (requires METRICS_TOKEN header when configured)' })
  async metricsEndpoint(@Headers('metrics-token') token?: string): Promise<string> {
    if (this.config.metricsToken && token !== this.config.metricsToken) {
      throw new UnauthorizedException({ error: { code: 'UNAUTHORIZED', message: 'metrics token required' } });
    }
    return this.metrics.collect();
  }
}
