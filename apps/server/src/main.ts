import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { createHash, randomBytes } from 'node:crypto';
import { AppModule } from './app.module';
import { RedisService } from './core/redis.service';
import { AckStashAdapter } from './core/ack-stash.adapter';
import type { AppRuntimeConfig } from './core/config';

/**
 * Freeze runtime secrets into process.env exactly once so the DI config
 * factory and this bootstrap see identical values across restarts.
 */
function freezeSecrets(): void {
  if (!process.env.SESSION_JWT_SECRET || process.env.SESSION_JWT_SECRET.length < 32) {
    process.env.SESSION_JWT_SECRET = randomBytes(64).toString('hex');
    Logger.warn('SESSION_JWT_SECRET generated for this boot (sessions die on restart)');
  }
  if (!process.env.PARTNER_CONTROL_SECRET) {
    process.env.PARTNER_CONTROL_SECRET = createHash('sha256')
      .update(randomBytes(32))
      .digest('hex');
  }
}

async function bootstrap(): Promise<void> {
  freezeSecrets();

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // RedisService connects via onModuleInit; grab handles for post-boot info.
  const redis = app.get(RedisService);
  const cfg = app.get<AppRuntimeConfig>('APP_CONFIG');

  app.use(helmet());
  app.setGlobalPrefix('api', { exclude: ['socket.io'] });
  // FIX: expose the Socket.IO ack callback to ws handlers (Nest 10 has no @Ack()).
  app.useWebSocketAdapter(new AckStashAdapter(app));

  const origins = cfg.allowedOrigins.length > 0 ? cfg.allowedOrigins : true;
  app.enableCors({
    origin: origins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Persona API')
    .setDescription(
      'Privacy-first anonymous discovery & real-time chat. There are NO accounts — ' +
        'a session IS a temporary JWT. All state lives in Redis and self-expires. ' +
        'Chat bodies are opaque AES-GCM ciphertext produced by the browser; the ' +
        'server relays and never decrypts.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // SwaggerModule.setup mounts at the literal path (global prefix not applied).
  SwaggerModule.setup('docs', app, document);

  app.enableShutdownHooks();
  await app.listen(cfg.serverPort);

  const url = await app.getUrl();
  Logger.log(`Persona API listening on ${url} (redis=${redis.isRedis ? 'up' : 'memory fallback'})`);
  Logger.log(`API docs: ${url}/docs (OpenAPI JSON: ${url}/docs-json)`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
