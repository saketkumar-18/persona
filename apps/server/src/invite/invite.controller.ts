import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ERROR_CODES } from '@ghostlink/shared';
import { TokenAuthGuard } from '../core/token-auth.guard';
import { InviteService } from './invite.service';
import { SessionService } from '../sessions/session.service';
import { GatewayRegistry } from '../core/gateway-registry';

const createInviteSchema = z
  .object({
    slug: z.string().trim().regex(/^[a-z0-9-]{3,32}$/i, 'invalid slug format').optional(),
  })
  .strict();

const joinInviteSchema = z
  .object({
    slug: z.string().trim().regex(/^[a-z0-9-]{3,32}$/i, 'invalid slug format'),
  })
  .strict();

function sid(req: Request): string {
  const id = (req as Request & { sessionId?: string }).sessionId;
  if (!id) throw new Error(ERROR_CODES.UNAUTHORIZED);
  return id;
}

@ApiTags('invite')
@ApiHeader({ name: 'Authorization', description: 'Bearer <sessionToken>', required: true })
@UseGuards(TokenAuthGuard)
@Controller('invite')
export class InviteController {
  constructor(
    private readonly invite: InviteService,
    private readonly sessions: SessionService,
    private readonly gateway: GatewayRegistry,
  ) {}

  @Post('create')
  @ApiOperation({ summary: 'Create an invite link (with optional custom slug) — share the URL to reconnect with the same person' })
  async create(@Req() req: Request, @Body() body: unknown): Promise<{ slug: string; url: string; expiresAt: number } | { slug: ''; url: ''; expiresAt: 0 }> {
    const me = sid(req);
    const parsed = createInviteSchema.safeParse(body ?? {});
    if (!parsed.success) return { slug: '', url: '', expiresAt: 0 };
    const result = await this.invite.createInvite(me, parsed.data.slug);
    if (!result) return { slug: '', url: '', expiresAt: 0 };
    return result;
  }

  @Post('join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join an invite link by slug — pairs you with the creator' })
  async join(@Req() req: Request, @Body() body: unknown): Promise<{ ok: boolean; roomId?: string; partner?: { id: string; alias: string; emoji: string; publicKey?: object; fingerprint?: string } }> {
    const me = sid(req);
    const parsed = joinInviteSchema.safeParse(body ?? {});
    if (!parsed.success) return { ok: false };
    const result = await this.invite.joinInvite(parsed.data.slug, me);
    if (!result) return { ok: false };
    const partner = await this.sessions.getSession(result.partnerId);
    const meSession = await this.sessions.getSession(me);
    await this.gateway.notifyPair(result.partnerId, result.roomId, me);
    await this.gateway.notifyPair(me, result.roomId, result.partnerId);
    return {
      ok: true,
      roomId: result.roomId,
      partner: partner && meSession
        ? {
            id: partner.id,
            alias: partner.alias,
            emoji: partner.emoji,
            publicKey: partner.publicKey,
            fingerprint: partner.fingerprint,
          }
        : undefined,
    };
  }
}