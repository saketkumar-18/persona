import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import {
  NearbyListResponse,
  GhostZoneResponse,
  GhostZoneListResponse,
  GhostZone,
  decodeGeohash,
  GHOST_ZONE_TTL_SECONDS,
  ERROR_CODES,
  MAX_NEARBY_RESULTS,
} from '@persona/shared';
import { TokenAuthGuard } from '../core/token-auth.guard';
import { DiscoveryService } from './discovery.service';
import { SessionService } from '../sessions/session.service';

/**
 * Discovery plane (REST, token-protected).
 *
 * Privacy model:
 *  - The browser coarsens raw GPS into a geohash cell BEFORE calling these
 *    endpoints; the server only ever receives the coarse cell id.
 *  - Distances/bearings are computed between cell centers, bounding disclosure
 *    by cell size. Member lists are never exposed — only aggregate counts.
 */

// Geohash base32 = "0123456789bcdefghjkmnpqrstuvwxyz" — letters i, l, o and
// every uppercase form are invalid. Validating the full alphabet here prevents
// decodeGeohash from throwing a raw Error (500) inside discovery endpoints.
const cellSchema = z
  .string()
  .regex(/^[0-9bcdefghjkmnpqrstuvwxyz]{4,12}$/, 'cell must be a valid lowercase geohash cell')
  .transform((s) => s.toLowerCase());

const nearbySchema = z
  .object({
    cellId: cellSchema,
    /** Only list sessions in travel/event mode. */
    travelOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(MAX_NEARBY_RESULTS).optional(),
  })
  .strict();

const zoneJoinSchema = z
  .object({
    cellId: cellSchema,
    ttlSeconds: z.number().int().min(60).max(4 * 3600).optional(),
  })
  .strict();

/** Safe geohash center — returns null instead of throwing on malformed cells. */
function safeCenter(cellId: string): { lat: number; lng: number } | null {
  try {
    return decodeGeohash(cellId).center;
  } catch {
    return null;
  }
}

function sid(req: Request): string {
  const id = (req as Request & { sessionId?: string }).sessionId;
  if (!id) throw new Error(ERROR_CODES.UNAUTHORIZED);
  return id;
}

@ApiTags('discovery')
@ApiHeader({ name: 'Authorization', description: 'Bearer <sessionToken>', required: true })
@UseGuards(TokenAuthGuard)
@Controller()
export class DiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly sessions: SessionService,
  ) {}

  @Post('discovery/nearby')
  @ApiOperation({ summary: 'List sessions near my coarse cell (GPS discovery, explicit consent)' })
  async nearby(@Req() req: Request, @Body() body: unknown): Promise<NearbyListResponse> {
    const parsed = nearbySchema.safeParse(body ?? {});
    if (!parsed.success) return { cellId: '', users: [] };
    const me = sid(req);
    const { cellId, travelOnly, limit } = parsed.data;
    await this.discovery.setCellPresence(me, cellId, false, 5 * 60);
    const users = await this.discovery.nearby(me, cellId, travelOnly ?? false, limit ?? MAX_NEARBY_RESULTS);
    return {
      cellId,
      users: users.map((u) => ({
        session: { id: u.id, alias: u.alias, emoji: u.emoji },
        distanceMeters: u.distanceMeters,
        bearingDeg: u.bearingDeg,
        travel: u.travel ?? false,
      })),
    };
  }

  @Post('discovery/zone')
  @ApiOperation({ summary: 'Enter a Ghost Zone: pin my coarse cell as a pairing bucket (Event/Travel Mode)' })
  async enterZone(@Req() req: Request, @Body() body: unknown): Promise<GhostZoneResponse> {
    const parsed = zoneJoinSchema.safeParse(body ?? {});
    const me = sid(req);
    if (!parsed.success) {
      const empty: GhostZone = { cellId: '', center: { lat: 0, lng: 0 }, createdAt: 0, expiresAt: 0 };
      return { zone: empty, activeSessions: 0 };
    }
    const { cellId, ttlSeconds } = parsed.data;
    const ttl = ttlSeconds ?? GHOST_ZONE_TTL_SECONDS;
    const center = safeCenter(cellId);
    if (!center) return { zone: { cellId: '', center: { lat: 0, lng: 0 }, createdAt: 0, expiresAt: 0 }, activeSessions: 0 };
    await this.discovery.setCellPresence(me, cellId, true, ttl);
    const members = await this.discovery.sameCell(cellId, me);
    return {
      zone: { cellId, center, createdAt: Date.now(), expiresAt: Date.now() + ttl * 1000 },
      activeSessions: members.length,
    };
  }

  @Get('discovery/zones')
  @ApiOperation({ summary: 'Active Ghost Zone for my current cell (cell id + count only)' })
  async zones(@Req() req: Request): Promise<GhostZoneListResponse> {
    const me = sid(req);
    const session = await this.sessions.getSession(me);
    const cellId = session?.presenceCell ?? '';
    if (!cellId) return { zones: [] };
    const members = await this.discovery.sameCell(cellId, me);
    return {
      zones: [
        {
          cellId,
          center: safeCenter(cellId) ?? { lat: 0, lng: 0 },
          createdAt: Date.now(),
          expiresAt: Date.now() + GHOST_ZONE_TTL_SECONDS * 1000,
        },
      ],
      totalMembers: members.length + 1,
    } as unknown as GhostZoneListResponse;
  }
}
