import { describe, expect, it } from 'vitest';
import { cellFromLatLng } from '../lib/geo';
import { decodeGeohash } from '@persona/shared';

describe('geo helpers (client-side coarsening)', () => {
  it('coarsens raw GPS into a geohash cell', () => {
    const cell = cellFromLatLng(48.8566, 2.3522, 'standard');
    expect(cell).toMatch(/^[0-9a-z]{6}$/);
    const center = decodeGeohash(cell).center;
    expect(Math.abs(center.lat - 48.8566)).toBeLessThan(0.05);
    expect(Math.abs(center.lng - 2.3522)).toBeLessThan(0.05);
  });

  it('reduced precision uses shorter cells', () => {
    const cell = cellFromLatLng(48.8566, 2.3522, 'reduced');
    expect(cell).toMatch(/^[0-9a-z]{5}$/);
  });

  it('two exact coords in the same block coarsen identically', () => {
    const a = cellFromLatLng(52.52001, 13.40495, 'standard');
    const b = cellFromLatLng(52.52002, 13.405, 'standard');
    expect(a).toBe(b);
  });
});
