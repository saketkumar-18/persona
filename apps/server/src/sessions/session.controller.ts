import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CreateSessionResponse,
  SessionResponse,
  OkResponse,
  GHOST_EMOJIS,
} from '@persona/shared';
import { SessionService, StoredSession } from './session.service';
import { JwtService } from '../core/jwt.service';
import { GatewayRegistry } from '../core/gateway-registry';
import { TokenAuthGuard } from '../core/token-auth.guard';

const createSchema = z
  .object({
    alias: z.string().trim().max(32).optional(),
    emoji: z.enum(GHOST_EMOJIS as unknown as [string, ...string[]]).optional(),
    ttlSeconds: z.number().int().min(60).max(24 * 3600).optional(),
    /** ECDH P-256 public key (JWK) — public fields only, never a secret. */
    publicKey: z.record(z.unknown()).optional() as z.ZodType<JsonWebKey>,
    fingerprint: z.string().max(24).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    alias: z.string().trim().max(32).optional(),
    emoji: z.enum(GHOST_EMOJIS as unknown as [string, ...string[]]).optional(),
    ttlSeconds: z.number().int().min(60).max(24 * 3600).optional(),
    publicKey: z.record(z.unknown()).optional() as z.ZodType<JsonWebKey>,
    fingerprint: z.string().max(24).optional(),
  })
  .strict();

function publicSession(s: StoredSession) {
  return {
    id: s.id,
    alias: s.alias,
    emoji: s.emoji,
    status: s.status,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    /** Public key material only (JWK) — needed by partners to derive the room key. */
    publicKey: s.publicKey,
    fingerprint: s.fingerprint,
  };
}

@ApiTags('sessions')
@ApiHeader({ name: 'Authorization', description: 'Bearer <sessionToken> (GET/PATCH/DELETE only)' })
@Controller('sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly gateway: GatewayRegistry,
  ) {}

  private sid(req: Request): string {
    const sid = (req as Request & { sessionId?: string }).sessionId;
    if (!sid) throw new UnauthorizedException({ error: { code: 'UNAUTHORIZED', message: 'missing session id' } });
    return sid;
  }

  @Post()
  @ApiOperation({ summary: 'Create a fresh anonymous session (no account needed)' })
  @ApiBody({ schema: { example: { alias: 'Lone Fox', emoji: '🦊', ttlSeconds: 14400 } } })
  @ApiResponse({ status: 201, description: 'Session + JWT created' })
  async create(@Body() body: unknown): Promise<CreateSessionResponse> {
    const parsed = createSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ error: { code: 'MALFORMED', message: 'invalid session request' } });
    }
    const session = await this.sessions.createSession(parsed.data);
    const idle = (await this.sessions.setStatus(session.id, 'idle')) ?? session;
    const token = this.jwt.signSessionToken(idle.id);
    return { sessionId: idle.id, token, session: publicSession(idle) };
  }

  @Get('me')
  @ApiHeader({ required: true, name: 'Authorization' })
  @UseGuards(TokenAuthGuard)
  @ApiOperation({ summary: 'Fetch my session profile' })
  async me(@Req() req: Request): Promise<SessionResponse> {
    const s = await this.sessions.getSession(this.sid(req));
    if (!s) throw new NotFoundException({ error: { code: 'SESSION_NOT_FOUND', message: 'session expired or destroyed' } });
    return { session: publicSession(s) };
  }

  @Patch('me')
  @ApiHeader({ required: true, name: 'Authorization' })
  @UseGuards(TokenAuthGuard)
  @ApiOperation({ summary: 'Update my session profile (alias, emoji, TTL)' })
  async update(@Req() req: Request, @Body() body: unknown): Promise<SessionResponse> {
    const id = this.sid(req);
    const parsed = updateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({ error: { code: 'MALFORMED', message: 'invalid update payload' } });
    }
    await this.sessions.update(
      {
        alias: parsed.data.alias,
        emoji: parsed.data.emoji,
        publicKey: parsed.data.publicKey,
        fingerprint: parsed.data.fingerprint,
      },
      id,
    );
    if (parsed.data.ttlSeconds) {
      const s = await this.sessions.getSession(id);
      if (s) {
        s.expiresAt = Math.min(Date.now() + parsed.data.ttlSeconds * 1000, Date.now() + 24 * 3600 * 1000);
        await this.sessions.save(s);
      }
    }
    const updated = await this.sessions.getSession(id);
    if (!updated) throw new NotFoundException({ error: { code: 'SESSION_NOT_FOUND', message: 'session expired or destroyed' } });
    return { session: publicSession(updated) };
  }

  @Delete('me')
  @HttpCode(200)
  @ApiHeader({ required: true, name: 'Authorization' })
  @UseGuards(TokenAuthGuard)
  @ApiOperation({ summary: 'Destroy my session immediately (invalidates the token)' })
  async destroy(@Req() req: Request): Promise<OkResponse> {
    const id = this.sid(req);
    await this.gateway.kickSession(id);
    await this.sessions.deleteSession(id);
    return { ok: true };
  }
}
