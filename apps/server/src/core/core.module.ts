import { Global, Module } from '@nestjs/common';
import { ConfigModule, AppRuntimeConfig } from './config';
import { JwtService } from './jwt.service';
import { MetricsService } from './metrics.service';
import { GatewayRegistry } from './gateway-registry';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: JwtService,
      inject: ['APP_CONFIG'],
      useFactory: (cfg: AppRuntimeConfig) =>
        new JwtService(cfg.sessionJwtSecret, cfg.sessionJwtTtlSeconds),
    },
    MetricsService,
    GatewayRegistry,
  ],
  exports: [JwtService, MetricsService, GatewayRegistry],
})
export class CoreModule {}
