import { Injectable } from '@nestjs/common';

/**
 * Bridge for REST controllers to poke the realtime gateway (e.g. force-kick
 * a session on DELETE /api/sessions/me). The gateway implementation registers
 * itself here at init so we avoid circular imports between HTTP and WS layers.
 */
export interface RealtimeBridge {
  kickSession(sessionId: string): Promise<void>;
  /** Notify a session's sockets of an inbound pairing (QR / in-band switch). */
  notifyPair(sessionId: string, roomId: string, partnerId: string): Promise<void>;
  /** Room was torn down (block/report) — notify sockets on this session's side. */
  notifyRoomClosed(sessionId: string, roomId: string, reason: string): Promise<void>;
}

@Injectable()
export class GatewayRegistry {
  private bridge: RealtimeBridge | null = null;

  register(bridge: RealtimeBridge): void {
    this.bridge = bridge;
  }

  async kickSession(sessionId: string): Promise<void> {
    if (this.bridge) await this.bridge.kickSession(sessionId);
  }

  async notifyPair(sessionId: string, roomId: string, partnerId: string): Promise<void> {
    if (this.bridge) await this.bridge.notifyPair(sessionId, roomId, partnerId);
  }

  async notifyRoomClosed(sessionId: string, roomId: string, reason: string): Promise<void> {
    if (this.bridge) await this.bridge.notifyRoomClosed(sessionId, roomId, reason);
  }
}
