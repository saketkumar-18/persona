import { describe, expect, it } from 'vitest';
import {
  encodeGeohash,
  encodeGeohashN,
  decodeGeohash,
  adjacentCells,
  coarsenToCell,
  haversineMeters,
  bearingDeg,
  isValidLatLng,
  jitterWithinCell,
} from '../src/geo';

describe('geohash encode/decode', () => {
  it('encodes a well-known reference point', () => {
    // San Francisco (37.7749, -122.4194) → geohash prefix "9q8y"
    const hash = encodeGeohashN(37.7749, -122.4194, 6);
    expect(hash.length).toBe(6);
    expect(hash.startsWith('9q8y')).toBe(true);
  });

  it('decode(encode(x)) contains the point within cell bounds', () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [48.8566, 2.3522],
      [-33.8688, 151.2093],
      [89.9, 179.9],
      [-89.9, -179.9],
    ];
    for (const [lat, lng] of points) {
      const hash = encodeGeohash(lat, lng, 'standard');
      const cell = decodeGeohash(hash);
      expect(lat).toBeGreaterThanOrEqual(cell.minLat);
      expect(lat).toBeLessThanOrEqual(cell.maxLat);
      expect(lng).toBeGreaterThanOrEqual(cell.minLng);
      expect(lng).toBeLessThanOrEqual(cell.maxLng);
    }
  });

  it('honors precision levels (standard=6 chars, reduced=5 chars)', () => {
    const lat = 52.52;
    const lng = 13.405;
    expect(encodeGeohash(lat, lng, 'standard').length).toBe(6);
    expect(encodeGeohash(lat, lng, 'reduced').length).toBe(5);
    // reduced must be a prefix of standard
    expect(encodeGeohash(lat, lng, 'standard').startsWith(encodeGeohash(lat, lng, 'reduced'))).toBe(true);
  });

  it('rejects invalid coordinates', () => {
    expect(() => encodeGeohashN(91, 0, 6)).toThrow();
    expect(() => encodeGeohashN(0, 181, 6)).toThrow();
    expect(() => decodeGeohash('invalid!')).toThrow();
    expect(isValidLatLng(NaN, 0)).toBe(false);
  });
});

describe('adjacentCells', () => {
  it('returns up to 8 same-length neighbors, never the cell itself', () => {
    const cell = encodeGeohashN(40.7128, -74.006, 6);
    const neighbors = adjacentCells(cell);
    expect(neighbors.length).toBeGreaterThanOrEqual(3);
    expect(neighbors.length).toBeLessThanOrEqual(8);
    for (const n of neighbors) {
      expect(n).not.toBe(cell);
      expect(n.length).toBe(cell.length);
    }
    expect(new Set(neighbors).size).toBe(neighbors.length);
  });
});

describe('privacy coarsening', () => {
  it('coarsenToCell replaces exact coordinates with the cell center', () => {
    const cell = coarsenToCell(40.7128, -74.006, 'standard');
    // cell center is on the grid — different from raw input
    expect(cell.center.lat).not.toBeCloseTo(40.7128, 4);
    expect(cell.cellId.length).toBe(6);
  });

  it('any point inside a cell coarsens to the same cell id', () => {
    const lat = 51.5074;
    const lng = -0.1278;
    const cell = coarsenToCell(lat, lng, 'reduced');
    const cornerLat = cell.minLat + (cell.maxLat - cell.minLat) * 0.1;
    const cornerLng = cell.minLng + (cell.maxLng - cell.minLng) * 0.9;
    expect(encodeGeohash(cornerLat, cornerLng, 'reduced')).toBe(cell.cellId);
  });

  it('jitter stays within a plausible bounding area of the original cell', () => {
    const base = coarsenToCell(35.6762, 139.6503, 'standard');
    const rng = () => 0.5; // deterministic center jitter → no movement
    const jittered = jitterWithinCell(base, rng);
    expect(haversineMeters(base.center, jittered.center)).toBeLessThan(5_000);
  });
});

describe('haversine + bearing', () => {
  it('computes sane distances', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const d = haversineMeters(london, paris);
    expect(d).toBeGreaterThan(330_000);
    expect(d).toBeLessThan(350_000);
    expect(haversineMeters(london, london)).toBeCloseTo(0, 3);
  });

  it('bearing points north for due-north travel', () => {
    const a = { lat: 10, lng: 0 };
    const b = { lat: 20, lng: 0 };
    expect(bearingDeg(a, b)).toBeCloseTo(0, 1);
    expect(bearingDeg(b, a)).toBeCloseTo(180, 1);
    expect(bearingDeg(a, a)).toBeNull();
  });
});
