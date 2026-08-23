/**
 * Geohash + geo privacy utilities.
 *
 * Privacy model: raw GPS coordinates never leave the browser untouched.
 * They are coarsened into a geohash cell BEFORE any network transmission.
 * Only the cell id (and its center, which is public by construction) is
 * stored and used for proximity disclosure.
 *
 * Default usage levels:
 *  - standard: 6-char geohash (~1.2km x 0.6km cell)
 *  - reduced:  5-char geohash (~4.9km x 4.9km cell)
 */

import type { GeoPrecisionLevel } from './types';

/** Cell lengths (in geohash chars) for each precision level. */
export const GEO_CELL_LENGTH: Record<GeoPrecisionLevel, number> = {
  standard: 6,
  reduced: 5,
};

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_INDEX: Record<string, number> = {};
for (let i = 0; i < BASE32.length; i += 1) BASE32_INDEX[BASE32[i] as string] = i;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoCell {
  cellId: string;
  /** Cell center. */
  center: LatLng;
  /** Bounds of the cell. */
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function isValidLatLng(lat: unknown, lng: unknown): lat is number & { __ok: true } {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Core geohash encoder for an arbitrary cell length (1..12 chars). */
export function encodeGeohashN(lat: number, lng: number, length: number): string {
  if (!isValidLatLng(lat, lng)) throw new Error('invalid lat/lng');
  const target = Math.max(1, Math.min(12, Math.floor(length)));
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < target) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng > mid) {
        ch = (ch << 1) | 1;
        minLng = mid;
      } else {
        ch = ch << 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat > mid) {
        ch = (ch << 1) | 1;
        minLat = mid;
      } else {
        ch = ch << 1;
        maxLat = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit += 1;
    } else {
      hash += BASE32[ch] ?? '';
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Encode lat/lng into a geohash of the given precision level length. */
export function encodeGeohash(lat: number, lng: number, precision: GeoPrecisionLevel): string {
  return encodeGeohashN(lat, lng, GEO_CELL_LENGTH[precision]);
}

/** Decode a geohash into its cell bounds + center. */
export function decodeGeohash(hash: string): GeoCell {
  if (!hash || typeof hash !== 'string') throw new Error('invalid geohash');
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let even = true;

  for (const c of hash.toLowerCase()) {
    const idx = BASE32_INDEX[c];
    if (idx === undefined) throw new Error(`invalid geohash char '${c}'`);
    let mask = 16;
    while (mask > 0) {
      if (even) {
        const mid = (minLng + maxLng) / 2;
        if (idx & mask) minLng = mid;
        else maxLng = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (idx & mask) minLat = mid;
        else maxLat = mid;
      }
      even = !even;
      mask >>= 1;
    }
  }
  return {
    cellId: hash.toLowerCase(),
    minLat,
    maxLat,
    minLng,
    maxLng,
    center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
  };
}

export interface GeoNeighborResult {
  /** The cell plus its 8 neighbors. */
  cells: string[];
}

/**
 * Compute the same-length neighbors of a geohash cell.
 * (Implemented via center-offset re-encoding for robustness.)
 */
export function adjacentCells(hash: string): string[] {
  const cell = decodeGeohash(hash);
  const dLat = cell.maxLat - cell.minLat;
  const dLng = cell.maxLng - cell.minLng;
  const out: string[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const lat = Math.max(-90, Math.min(90, cell.center.lat + dy * dLat));
      const lng = Math.max(-180, Math.min(180, cell.center.lng + dx * dLng));
      try {
        const neighbor = encodeGeohashByLength(lat, lng, hash.length);
        if (neighbor !== hash.toLowerCase()) out.push(neighbor);
      } catch {
        // pole/edge cells: skip
      }
    }
  }
  return [...new Set(out)];
}

function encodeGeohashByLength(lat: number, lng: number, length: number): string {
  return encodeGeohashN(lat, lng, length);
}

/** Coarsen raw coordinates to the center of their geohash cell. */
export function coarsenToCell(lat: number, lng: number, precision: GeoPrecisionLevel): GeoCell {
  const cellId = encodeGeohash(lat, lng, precision);
  return decodeGeohash(cellId);
}

/** Great-circle distance between two points, meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}

/** Approximate bearing from a to b (deg, 0=N, clockwise). Null if ~zero distance. */
export function bearingDeg(a: LatLng, b: LatLng): number | null {
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  if (Math.abs(dLat) < 1e-9 && Math.abs(dLng) < 1e-9) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(dLng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(dLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Add uniform jitter inside a cell (≤ cell radius) before coarsening. Default: ON. */
export function jitterWithinCell(cell: GeoCell, rng: () => number = Math.random): GeoCell {
  const latJit = (cell.maxLat - cell.minLat) * (rng() - 0.5) * 0.9;
  const lngJit = (cell.maxLng - cell.minLng) * (rng() - 0.5) * 0.9;
  const lat = Math.max(-90, Math.min(90, cell.center.lat + latJit));
  const lng = Math.max(-180, Math.min(180, cell.center.lng + lngJit));
  const cellId = encodeGeohashByLength(lat, lng, cell.cellId.length);
  return decodeGeohash(cellId);
}

export function randomCellNear(center: LatLng, precision: GeoPrecisionLevel): GeoCell {
  const base = coarsenToCell(center.lat, center.lng, precision);
  return jitterWithinCell(base);
}
