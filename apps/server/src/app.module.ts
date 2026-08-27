import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './core/config';
import { CoreModule } from './core/core.module';
import { SessionService } from './sessions/session.service';
import { SessionController } from './sessions/session.controller';
import { RoomService } from './rooms/room.service';
import { MatchingService } from './matching/matching.service';
import { DiscoveryService } from './discovery/discovery.service';
import { DiscoveryController } from './discovery/discovery.controller';
import { QrService } from './qr/qr.service';
import { QrController } from './qr/qr.controller';
import { InviteService } from './invite/invite.service';
import { InviteController } from './invite/invite.controller';
import { ModerationService } from './moderation/moderation.service';
import { ModerationController } from './moderation/moderation.controller';
import { SystemController } from './system/system.controller';
import { RealtimeGateway } from './realtime/realtime.gateway';

@Module({
  imports: [
    ConfigModule,
    CoreModule,
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: 'burst', ttl: 10_000, limit: 30 },
    ]),
  ],
  controllers: [
    SessionController,
    DiscoveryController,
    QrController,
    InviteController,
    ModerationController,
    SystemController,
  ],
  providers: [
    SessionService,
    RoomService,
    MatchingService,
    DiscoveryService,
    QrService,
    InviteService,
    ModerationService,
    RealtimeGateway,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
