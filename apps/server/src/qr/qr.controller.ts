import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ConnectResponse, CreateQrResponse, RedeemQrResponse, ERROR_CODES } from '@persona/shared';
import { TokenAuthGuard } from '../core/token-auth.guard';
import { QrService } from './qr.service';
import { SessionService } from '../sessions/session.service';
import { GatewayRegistry } from '../core/gateway-registry';

const redeemSchema = z
  .object({
    code: z.string().trim().regex(/^ql_[a-z2-9]{6}$/i, 'invalid pairing code'),
  })
  .strict();

const connectSchema = z
  .object({
    sessionId: z.string().startsWith('gl_'),
  })
  .strict();

function sid(req: Request): string {
  const id = (req as Request & { sessionId?: string }).sessionId;
  if (!id) throw new Error(ERROR_CODES.UNAUTHORIZED);
  return id;
}

@ApiTags('qr')
@ApiHeader({ name: 'Authorization', description: 'Bearer <sessionToken>', required: true })
@UseGuards(TokenAuthGuard)
@Controller('qr')
export class QrController {
  constructor(
    private readonly qr: QrService,
    private readonly sessions: SessionService,
    private readonly gateway: GatewayRegistry,
  ) {}

  @Post('create')
  @ApiOperation({ summary: 'Generate a short pairing code (shown as QR, expires in 5 min)' })
  async create(@Req() req: Request): Promise<CreateQrResponse> {
    const me = sid(req);
    try {
      return await this.qr.createCode(me);
    } catch {
      return { code: '', expiresAt: 0 };
    }
  }

  @Post('redeem')
  @HttpCode(200)
  @ApiOperation({ summary: 'Redeem a scanned pairing code → instant room with the code owner' })
  async redeem(@Req() req: Request, @Body() body: unknown): Promise<RedeemQrResponse> {
    const me = sid(req);
    const parsed = redeemSchema.safeParse(body ?? {});
    if (!parsed.success) return { ok: false };
    const result = await this.qr.redeemCode(parsed.data.code.toLowerCase(), me);
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

  @Post('connect')
  @HttpCode(200)
  @ApiOperation({ summary: 'Connect directly with a discovered session (nearby "Connect" flow)' })
  async connect(@Req() req: Request, @Body() body: unknown): Promise<ConnectResponse> {
    const me = sid(req);
    const parsed = connectSchema.safeParse(body ?? {});
    if (!parsed.success) return { ok: false };
    const result = await this.qr.connectWith(me, parsed.data.sessionId);
    if (!result) return { ok: false };
    const partner = await this.sessions.getSession(result.partnerId);
    await this.gateway.notifyPair(result.partnerId, result.roomId, me);
    return {
      ok: true,
      roomId: result.roomId,
      partner: partner
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
