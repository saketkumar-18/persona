import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import {
  ERROR_CODES,
  type ErrorCode,
  type ErrorFrame,
  MAX_CHAT_DATA_LENGTH,
} from '@ghostlink/shared';
import { JwtService } from '../core/jwt.service';
import { GatewayRegistry, RealtimeBridge } from '../core/gateway-registry';
import { SessionService } from '../sessions/session.service';
import { RoomService, StoredRoom } from '../rooms/room.service';
import { MatchingService } from '../matching/matching.service';
import { ModerationService } from '../moderation/moderation.service';
import { MetricsService } from '../core/metrics.service';
import { DiscoveryService } from '../discovery/discovery.service';
import { AppRuntimeConfig } from '../core/config';

interface SocketData {
  sessionId: string;
}

type Ack = (response: unknown) => void;

/**
 * GhostLink realtime plane (Socket.IO, path /socket.io, default namespace).
 *
 * Auth: JWT in `socket.handshake.auth.token` — verified before any event.
 * Rooms: two-person ephemeral channels; chat messages are relayed as opaque
 * AES-GCM ciphertext envelopes produced by the client (server never decrypts).
 */
@WebSocketGateway({
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: 16 * 1024,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy, RealtimeBridge
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  private roomSweep: NodeJS.Timeout | null = null;

  private readonly sessionsBySocket = new Map<string, SocketData>();

  constructor(
    private readonly jwt: JwtService,
    private readonly registry: GatewayRegistry,
    private readonly sessions: SessionService,
    private readonly rooms: RoomService,
    private readonly matching: MatchingService,
    private readonly moderation: ModerationService,
    private readonly metrics: MetricsService,
    private readonly discovery: DiscoveryService,
    @Inject('APP_CONFIG') private readonly config: AppRuntimeConfig,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.roomSweep = setInterval(() => {
      void this.sweepExpiredRooms();
    }, 15_000);
  }

  onModuleDestroy(): void {
    if (this.roomSweep) {
      clearInterval(this.roomSweep);
      this.roomSweep = null;
    }
  }

  // ----- connection lifecycle ----------------------------------------------

  async handleConnection(socket: Socket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      this.emitError(socket, ERROR_CODES.MALFORMED, 'missing auth token', true);
      socket.disconnect(true);
      return;
    }
    const payload = this.jwt.verifySessionToken(token);
    if (!payload) {
      this.emitError(socket, ERROR_CODES.INVALID_TOKEN, 'invalid or expired token', true);
      socket.disconnect(true);
      return;
    }
    const session = await this.sessions.getSession(payload.sid);
    if (!session) {
      this.emitError(socket, ERROR_CODES.SESSION_NOT_FOUND, 'session not found', true);
      socket.disconnect(true);
      return;
    }
    (socket as Socket & { data: SocketData }).data = { sessionId: session.id };
    this.sessionsBySocket.set(socket.id, { sessionId: session.id });
    await socket.join(this.socketsRoom(session.id));
    await this.sessions.setStatus(session.id, session.status === 'in_chat' ? 'in_chat' : 'idle');
    this.logger.debug(`socket connected for session ${session.id}`);
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const data = this.sessionsBySocket.get(socket.id) as SocketData | undefined;
    this.sessionsBySocket.delete(socket.id);
    if (!data) return;
    const session = await this.sessions.getSession(data.sessionId);
    if (!session) return;
    await this.matching.removeFromAllQueues(data.sessionId);
    const room = await this.rooms.roomForSession(data.sessionId);
    if (room) {
      await this.leaveRoomInternal(room, data.sessionId, 'partner_left');
    }
    await this.sessions.setStatus(data.sessionId, 'offline');
  }

  // ----- matching ------------------------------------------------------------

  @SubscribeMessage('match:start')
  async onMatchStart(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { source?: string; zoneCell?: string },
    ack?: Ack,
  ): Promise<void> {
    const me = await this.mySession(socket);
    if (!me || !ack) return;

    const blocked = await this.moderation.blockedIds(me.id);
    const room = await this.rooms.roomForSession(me.id);
    if (room) {
      ack({ ok: false, error: ERROR_CODES.ALREADY_IN_ROOM });
      return;
    }

    const zoneCell = body?.source === 'zone' && typeof body.zoneCell === 'string' ? body.zoneCell : null;
    const result = await this.matching.findPartner(
      { id: me.id, alias: me.alias, emoji: me.emoji },
      zoneCell,
      blocked,
    );

    if (result.roomId && result.partnerId) {
      const partner = await this.sessions.getSession(result.partnerId);
      const info = partner
        ? {
            id: partner.id,
            alias: partner.alias,
            emoji: partner.emoji,
            publicKey: partner.publicKey,
            fingerprint: partner.fingerprint,
          }
        : null;
      ack({ ok: true, matched: true, roomId: result.roomId, partner: info });
      await this.emitMatchFound(result.partnerId, result.roomId, me);
    } else {
      ack({ ok: true, queued: true, position: result.position ?? 0 });
    }
  }

  @SubscribeMessage('match:cancel')
  async onMatchCancel(@ConnectedSocket() socket: Socket, _body: unknown, ack?: Ack): Promise<void> {
    const me = await this.mySession(socket);
    if (!me) return;
    await this.matching.leaveQueue(me.id);
    ack?.({ ok: true });
  }

  private async emitMatchFound(partnerId: string, roomId: string, me: { id: string; alias: string; emoji: string; publicKey?: JsonWebKey; fingerprint?: string }): Promise<void> {
    await this.server.to(this.socketsRoom(partnerId)).emit('match:found', {
      roomId,
      partner: {
        id: me.id,
        alias: me.alias,
        emoji: me.emoji,
        publicKey: me.publicKey,
        fingerprint: me.fingerprint,
      },
    });
  }

  // ----- room lifecycle --------------------------------------------------------

  @SubscribeMessage('room:join')
  async onRoomJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { roomId?: string },
    ack?: Ack,
  ): Promise<void> {
    const me = await this.mySession(socket);
    if (!me) return;
    const roomId = body?.roomId;
    if (!roomId) {
      ack?.({ ok: false, error: ERROR_CODES.MALFORMED });
      return;
    }
    const room = await this.rooms.getRoom(roomId);
    if (!room || !room.members.includes(me.id)) {
      ack?.({ ok: false, error: ERROR_CODES.ROOM_NOT_FOUND });
      return;
    }
    await socket.join(this.socketsRoom(me.id));
    ack?.({ ok: true, roomId, expiresAt: room.expiresAt });
    const partnerId = room.members.find((m) => m !== me.id);
    if (partnerId) {
      await this.server.to(this.socketsRoom(partnerId)).emit('room:joined', { roomId, partner: { id: me.id, alias: me.alias, emoji: me.emoji } });
    }
  }

  @SubscribeMessage('room:leave')
  async onRoomLeave(@ConnectedSocket() socket: Socket, @MessageBody() _body: unknown, ack?: Ack): Promise<void> {
    const me = await this.mySession(socket);
    if (!me) return;
    const room = await this.rooms.roomForSession(me.id);
    if (!room) {
      ack?.({ ok: false, error: ERROR_CODES.NOT_IN_ROOM });
      return;
    }
    await this.leaveRoomInternal(room, me.id, 'left');
    ack?.({ ok: true });
  }

  private async leaveRoomInternal(room: StoredRoom, sessionId: string, reason: 'left' | 'blocked' | 'expired' | 'partner_left'): Promise<void> {
    await this.rooms.removeMember(room.id, sessionId);
    await this.sessions.setStatus(sessionId, 'idle');
    const partnerId = room.members.find((m) => m !== sessionId);
    if (partnerId) {
      await this.server.to(this.socketsRoom(partnerId)).emit('room:left', { roomId: room.id, reason });
      await this.sessions.setStatus(partnerId, 'idle');
    }
    await socketLeaveAll(this.server, room.id);
    await this.rooms.destroyRoom(room.id);
    this.metrics.setRoomsActive(await this.rooms.countActive());
  }

  // ----- chat relay ---------------------------------------------------------

  @SubscribeMessage('chat:message')
  async onChatMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { roomId?: string; data?: unknown },
    ack?: Ack,
  ): Promise<void> {
    const me = await this.mySession(socket);
    if (!me || !ack) return;
    const roomId = body?.roomId;
    const data = body?.data;
    if (!roomId || typeof data !== 'string' || data.length === 0) {
      ack({ ok: false, error: ERROR_CODES.MALFORMED });
      return;
    }
    if (data.length > MAX_CHAT_DATA_LENGTH) {
      ack({ ok: false, error: ERROR_CODES.PAYLOAD_TOO_LARGE });
      return;
    }
    const room = await this.rooms.getRoom(roomId);
    if (!room || !room.members.includes(me.id)) {
      ack({ ok: false, error: ERROR_CODES.NOT_IN_ROOM, hint: 'leave happened automatically — rejoin via room:join' });
      return;
    }
    if (new Set(room.members).has(me.id) === false) {
      ack({ ok: false, error: ERROR_CODES.NOT_IN_ROOM });
      return;
    }
    const partnerId = room.members.find((m) => m !== me.id);
    if (!partnerId) {
      ack({ ok: false, error: ERROR_CODES.NOT_IN_ROOM });
      return;
    }
    if (await this.moderation.isBlocked(me.id, partnerId)) {
      ack({ ok: false, error: ERROR_CODES.BLOCKED });
      return;
    }
    this.metrics.recordMessage(Buffer.byteLength(data));
    await this.server.to(this.socketsRoom(partnerId)).emit('chat:message', {
      roomId,
      data,
      receivedAt: Date.now(),
    });
    ack({ ok: true });
  }

  @SubscribeMessage('chat:typing')
  async onTyping(@ConnectedSocket() socket: Socket, @MessageBody() body: { roomId?: string; isTyping?: boolean }): Promise<void> {
    const me = await this.mySession(socket);
    if (!me || !body?.roomId) return;
    const room = await this.rooms.getRoom(body.roomId);
    if (!room || !room.members.includes(me.id)) return;
    const partnerId = room.members.find((m) => m !== me.id);
    if (!partnerId) return;
    await this.server.to(this.socketsRoom(partnerId)).emit('chat:typing', { roomId: body.roomId, isTyping: body.isTyping ?? true });
  }

  // ----- presence ----------------------------------------------------------

  @SubscribeMessage('presence:tick')
  async onPresenceTick(@ConnectedSocket() socket: Socket, @MessageBody() body: { cellId?: string; travel?: boolean }): Promise<void> {
    const me = await this.mySession(socket);
    if (!me || typeof body?.cellId !== 'string') return;
    if (!/^[0-9a-z]{5,8}$/.test(body.cellId)) return;
    const ttl = 120; // presence entry expires unless heartbeated
    await this.redisSetPresence(me, body.cellId, body.travel ?? false, ttl);
  }

  @SubscribeMessage('presence:clear')
  async onPresenceClear(@ConnectedSocket() socket: Socket): Promise<void> {
    const me = await this.mySession(socket);
    if (!me) return;
    await this.discovery.clearPresence(me.id);
  }

  // ----- reports via realtime (also available over REST) ---------------------

  @SubscribeMessage('room:report')
  async onReport(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { roomId?: string; category?: string; note?: string },
    ack?: Ack,
  ): Promise<void> {
    const me = await this.mySession(socket);
    if (!me) return;
    if (!body?.roomId) return;
    const room = await this.rooms.getRoom(body.roomId);
    if (!room || !room.members.includes(me.id)) return;
    const partnerId = room.members.find((m) => m !== me.id);
    if (!partnerId) return;
    const result = await this.moderation.report(me.id, partnerId, String(body.category ?? 'other'), body.note);
    ack?.({ ok: result.ok, escalated: result.escalated });
    await this.server.to(this.socketsRoom(me.id)).emit('notice', { message: 'Thanks — reports are reviewed.', level: 'info' });
  }

  @SubscribeMessage('room:block')
  async onBlock(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { roomId?: string; reason?: string },
    ack?: Ack,
  ): Promise<void> {
    const me = await this.mySession(socket);
    if (!me || !body?.roomId) return;
    const room = await this.rooms.getRoom(body.roomId);
    if (!room || !room.members.includes(me.id)) return;
    const partnerId = room.members.find((m) => m !== me.id);
    if (!partnerId) return;
    await this.moderation.block(me.id, partnerId);
    await this.leaveRoomInternal(room, me.id, 'blocked');
    await this.server.to(this.socketsRoom(partnerId)).emit('notice', { message: 'Your partner ended this chat.', level: 'info' });
    ack?.({ ok: true });
  }

  // ----- bridge (used by REST/controllers) -----------------------------------

  async kickSession(sessionId: string): Promise<void> {
    const sockets = await this.server.in(this.socketsRoom(sessionId)).fetchSockets();
    for (const s of sockets) {
      s.emit('error', { code: ERROR_CODES.SESSION_EXPIRED, message: 'session destroyed', fatal: true } satisfies ErrorFrame);
      s.disconnect(true);
    }
  }

  async notifyPair(sessionId: string, roomId: string, partnerId: string): Promise<void> {
    const partner = await this.sessions.getSession(partnerId);
    await this.server.to(this.socketsRoom(sessionId)).emit('match:found', {
      roomId,
      partner: partner
        ? {
            id: partner.id,
            alias: partner.alias,
            emoji: partner.emoji,
            publicKey: partner.publicKey,
            fingerprint: partner.fingerprint,
          }
        : null,
    });
  }

  async notifyRoomClosed(sessionId: string, roomId: string, reason: string): Promise<void> {
    await this.server.to(this.socketsRoom(sessionId)).emit('room:left', { roomId, reason: reason as never });
  }

  // ----- helpers -------------------------------------------------------------

  private async redisSetPresence(me: { id: string }, cellId: string, travel: boolean, ttl: number): Promise<void> {
    await this.discovery.setCellPresence(me.id, cellId, travel, ttl);
  }

  private async sweepExpiredRooms(): Promise<void> {
    const active = await this.rooms.listActiveRoomIds();
    for (const roomId of active) {
      const room = await this.rooms.getRoom(roomId);
      if (!room) {
        await this.server.to(roomId).emit('room:expired', { roomId });
        await socketLeaveAll(this.server, roomId);
      }
    }
    this.metrics.setSessionsActive(await this.sessions.countActive());
    this.metrics.setRoomsActive(await this.rooms.countActive());
  }

  private async mySession(socket: Socket) {
    const data = (socket as Socket & { data: SocketData }).data;
    if (!data?.sessionId) return null;
    return this.sessions.getSession(data.sessionId);
  }

  private socketsRoom(sessionId: string): string {
    return `sess:${sessionId}`;
  }

  private emitError(socket: Socket, code: ErrorCode, message: string, fatal = false): void {
    socket.emit('error', { code, message, fatal } satisfies ErrorFrame);
  }
}

async function socketLeaveAll(server: Server, roomId: string): Promise<void> {
  const sockets = await server.in(roomId).fetchSockets();
  for (const s of sockets) {
    await s.leave(roomId);
  }
}
