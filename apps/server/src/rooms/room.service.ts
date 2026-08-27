import { Inject, Injectable, Logger } from '@nestjs/common';
import { generateRoomId } from '@persona/shared';
import { RedisService } from '../core/redis.service';
import { AppRuntimeConfig } from '../core/config';

export interface StoredRoom {
  id: string;
  members: [string, string];
  createdAt: number;
  expiresAt: number;
  kind: 'global' | 'zone' | 'qr' | 'invite';
  /** For invite rooms: the human-readable slug (e.g., "cozy-forest-42"). */
  inviteSlug?: string;
}

/**
 * Ephemeral two-person chat rooms. Rooms live only in Redis, expire with the
 * TTL, and never carry message history — messages pass through the WS layer
 * without persistence.
 */
@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);

  constructor(
    private readonly redis: RedisService,
    @Inject('APP_CONFIG') private readonly config: AppRuntimeConfig,
  ) {}

  private key(id: string): string {
    return `room:${id}`;
  }

  private inviteSlugKey(slug: string): string {
    return `room:invite:${slug}`;
  }

  async createRoom(members: [string, string], kind: StoredRoom['kind']): Promise<StoredRoom> {
    return this.createRoomWithSlug(members, kind, undefined);
  }

  /** Create an invite room with a specific human-readable slug. */
  async createInviteRoom(members: [string, string], slug: string): Promise<StoredRoom | null> {
    const cleanSlug = slug.toLowerCase().trim();
    if (!/^[a-z0-9-]{3,32}$/.test(cleanSlug)) return null;
    // Check if slug is taken
    const existing = await this.redis.get(this.inviteSlugKey(cleanSlug));
    if (existing) return null;
    return this.createRoomWithSlug(members, 'invite', cleanSlug);
  }

  private async createRoomWithSlug(
    members: [string, string],
    kind: StoredRoom['kind'],
    inviteSlug: string | undefined,
  ): Promise<StoredRoom> {
    const id = generateRoomId();
    const now = Date.now();
    const ttl = this.config.defaultRoomTtlSeconds;
    const room: StoredRoom = { id, members, createdAt: now, expiresAt: now + ttl * 1000, kind };
    if (inviteSlug) room.inviteSlug = inviteSlug;
    await this.redis.set(this.key(id), JSON.stringify(room), ttl);
    await this.redis.sadd('rooms:active', id);
    await this.redis.expire('rooms:active', ttl);
    // session -> room reverse index
    for (const m of members) {
      await this.redis.set(`sessroom:${m}`, id, ttl);
    }
    // invite slug -> room id mapping
    if (inviteSlug) {
      await this.redis.set(this.inviteSlugKey(inviteSlug), id, ttl);
    }
    this.logger.debug(`Room created: ${id} (${kind}${inviteSlug ? `, invite:${inviteSlug}` : ''})`);
    return room;
  }

  async getRoom(id: string): Promise<StoredRoom | null> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    try {
      const room = JSON.parse(raw) as StoredRoom;
      if (room.expiresAt <= Date.now()) {
        await this.destroyRoom(id);
        return null;
      }
      return room;
    } catch {
      return null;
    }
  }

  /** Get room by invite slug. */
  async getRoomByInviteSlug(slug: string): Promise<StoredRoom | null> {
    const cleanSlug = slug.toLowerCase().trim();
    const roomId = await this.redis.get(this.inviteSlugKey(cleanSlug));
    if (!roomId) return null;
    return this.getRoom(roomId);
  }

  async roomForSession(sessionId: string): Promise<StoredRoom | null> {
    const roomId = await this.redis.get(`sessroom:${sessionId}`);
    if (!roomId) return null;
    return this.getRoom(roomId);
  }

  /** Remove a session from its room mapping; if both left the room is gone. */
  async removeMember(roomId: string, sessionId: string): Promise<StoredRoom | null> {
    const room = await this.getRoom(roomId);
    if (!room) return null;
    await this.redis.del(`sessroom:${sessionId}`);
    return room;
  }

  async destroyRoom(id: string): Promise<void> {
    const room = await this.getRoom(id);
    if (room) {
      for (const m of room.members) {
        await this.redis.del(`sessroom:${m}`);
        await this.redis.srem('rooms:active', id);
      }
      // Clean up invite slug mapping
      if (room.inviteSlug) {
        await this.redis.del(this.inviteSlugKey(room.inviteSlug));
      }
    }
    await this.redis.del(this.key(id));
    await this.redis.srem('rooms:active', id);
  }

  async countActive(): Promise<number> {
    const ids = await this.redis.smembers('rooms:active');
    let n = 0;
    for (const id of ids) {
      const r = await this.getRoom(id);
      if (r) n += 1;
      else await this.redis.srem('rooms:active', id);
    }
    return n;
  }

  async listActiveRoomIds(): Promise<string[]> {
    return this.redis.smembers('rooms:active');
  }
}
