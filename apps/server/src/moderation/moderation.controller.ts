import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { BlockResponse, ReportResponse, ERROR_CODES } from '@persona/shared';
import { TokenAuthGuard } from '../core/token-auth.guard';
import { ModerationService } from './moderation.service';
import { SessionService } from '../sessions/session.service';
import { RoomService } from '../rooms/room.service';
import { GatewayRegistry } from '../core/gateway-registry';

const blockSchema = z
  .object({
    sessionId: z.string().startsWith('gl_'),
    roomId: z.string().startsWith('rm_').optional(),
    reason: z.string().max(40).optional(),
  })
  .strict();

const reportSchema = z
  .object({
    sessionId: z.string().startsWith('gl_'),
    roomId: z.string().startsWith('rm_').optional(),
    category: z.enum(['harassment', 'spam', 'inappropriate', 'impersonation', 'other']).default('other'),
    note: z.string().max(500).optional(),
  })
  .strict();

function sid(req: Request): string {
  const id = (req as Request & { sessionId?: string }).sessionId;
  if (!id) throw new Error(ERROR_CODES.UNAUTHORIZED);
  return id;
}

@ApiTags('moderation')
@ApiHeader({ name: 'Authorization', description: 'Bearer <sessionToken>', required: true })
@UseGuards(TokenAuthGuard)
@Controller('moderation')
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly sessions: SessionService,
    private readonly rooms: RoomService,
    private readonly gateway: GatewayRegistry,
  ) {}

  @Post('block')
  @HttpCode(200)
  @ApiOperation({ summary: 'Block another session; any shared room is immediately torn down' })
  async block(@Req() req: Request, @Body() body: unknown): Promise<BlockResponse> {
    const me = sid(req);
    const parsed = blockSchema.safeParse(body ?? {});
    if (!parsed.success) return { ok: false, mutual: false };
    const result = await this.moderation.block(me, parsed.data.sessionId);

    const roomId = parsed.data.roomId;
    if (roomId) {
      const room = await this.rooms.getRoom(roomId);
      if (room && room.members.includes(me)) {
        const partnerId = room.members.find((m) => m !== me);
        await this.rooms.destroyRoom(roomId);
        await this.sessions.setStatus(me, 'idle');
        if (partnerId) {
          await this.sessions.setStatus(partnerId, 'idle');
          await this.gateway.notifyRoomClosed(partnerId, roomId, 'partner_left');
        }
      }
    }
    return result;
  }

  @Post('report')
  @HttpCode(200)
  @ApiOperation({ summary: 'File an abuse report (counters + hashed note only, no persistence)' })
  async report(@Req() req: Request, @Body() body: unknown): Promise<ReportResponse> {
    const me = sid(req);
    const parsed = reportSchema.safeParse(body ?? {});
    if (!parsed.success) return { ok: false };
    const { sessionId, category, note } = parsed.data;
    try {
      const result = await this.moderation.report(me, sessionId, category, note);
      return { ok: result.ok, escalated: result.escalated };
    } catch {
      return { ok: false };
    }
  }
}
