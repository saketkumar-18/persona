import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../core/redis.service';
import { AppRuntimeConfig } from '../core/config';
import { SessionService } from '../sessions/session.service';
import { RoomService, StoredRoom } from '../rooms/room.service';
import { MetricsService } from '../core/metrics.service';
import { generateInviteSlug } from '@ghostlink/shared';

/**
 * Invite links / named rooms.
 *
 * Flow: session A creates an invite link with a chosen or random slug (e.g.,
 * "cozy-forest-42"). Session B opens the link (or types the slug) → joins the
 * same room. The slug is the secret; it expires with the room TTL and is
 * rate-limited per session.
 */
@Injectable()
export class InviteService {
  constructor(
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
    private readonly rooms: RoomService,
    private readonly metrics: MetricsService,
    @Inject('APP_CONFIG') private readonly config: AppRuntimeConfig,
  ) {}

  private countKey(sessionId: string): string {
    return `invite:count:${sessionId}`;
  }

  /** Create an invite link; caller provides the second member when they join. */
  async createInvite(mySessionId: string, customSlug?: string): Promise<{ slug: string; url: string; expiresAt: number } | null> {
    const created = await this.redis.incr(this.countKey(mySessionId), this.config.defaultRoomTtlSeconds);
    if (created > this.config.maxInvitesPerSession) {
      return null; // rate limited
    }

    let slug: string;
    let room: StoredRoom | null = null;

    if (customSlug) {
      // Use provided slug (already validated by controller)
      room = await this.rooms.createInviteRoom([mySessionId, ''], customSlug);
      if (!room) return null; // slug taken
      slug = room.inviteSlug!;
    } else {
      // Generate a unique slug
      for (let i = 0; i < 5; i++) {
        const candidate = generateInviteSlug();
        room = await this.rooms.createInviteRoom([mySessionId, ''], candidate);
        if (room) {
          slug = candidate;
          break;
        }
      }
      if (!room) return null;
    }

    // At this point, slug is always assigned (both branches return early if not)
    const expiresAt = Date.now() + this.config.defaultRoomTtlSeconds * 1000;
    const baseUrl = process.env.INVITE_BASE_URL || 'https://ghostlink-web-eight.vercel.app';
    // Query-param form so the static-export frontend can handle any slug
    // without pre-rendering a route per invite.
    return { slug: slug!, url: `${baseUrl}/join?slug=${encodeURIComponent(slug!)}`, expiresAt };
  }

  /** Join an invite room by slug (the second participant). */
  async joinInvite(slug: string, joinerSessionId: string): Promise<{ roomId: string; partnerId: string } | null> {
    const cleanSlug = slug.toLowerCase().trim();
    const room = await this.rooms.getRoomByInviteSlug(cleanSlug);
    if (!room || room.kind !== 'invite') return null;

    // Room should have one member (the creator) and one empty slot
    if (room.members[1] && room.members[1] !== '') {
      // Both slots filled — could be a race, check if joiner is already one of them
      if (room.members.includes(joinerSessionId)) {
        return { roomId: room.id, partnerId: room.members.find(m => m !== joinerSessionId)! };
      }
      return null;
    }

    const creatorId = room.members[0];
    if (creatorId === joinerSessionId) return null; // can't join own invite

    const creator = await this.sessions.getSession(creatorId);
    const joiner = await this.sessions.getSession(joinerSessionId);
    if (!creator || !joiner || creator.status === 'in_chat' || joiner.status === 'in_chat') return null;

    // Update room with joiner
    room.members = [creatorId, joinerSessionId] as [string, string];
    await this.redis.set(`room:${room.id}`, JSON.stringify(room), this.config.defaultRoomTtlSeconds);

    // Update session->room mapping for joiner
    await this.redis.set(`sessroom:${joinerSessionId}`, room.id, this.config.defaultRoomTtlSeconds);

    await this.sessions.setStatus(creatorId, 'in_chat');
    await this.sessions.setStatus(joinerSessionId, 'in_chat');
    this.metrics.recordMatch('invite');

    return { roomId: room.id, partnerId: creatorId };
  }
}