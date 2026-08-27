/**
 * GPS discovery helpers. Raw coordinates are coarsened into a geohash cell
 * ON-DEVICE before anything is transmitted — the server only ever receives
 * the coarse cell id.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GeoPrecisionLevel,
  encodeGeohashN,
  decodeGeohash,
  jitterWithinCell,
  coarsenToCell,
} from '@persona/shared';

export type GeoConsent = 'unset' | 'granted' | 'denied' | 'unavailable';

export interface GeoState {
  consent: GeoConsent;
  /** Coarse cell id (never raw coords). Null until first fix. */
  cellId: string | null;
  /** Center of the cell — safe to display on the map. */
  cellCenter: { lat: number; lng: number } | null;
  error: string | null;
}

export function geoSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

export function useGeoCoarse(precision: GeoPrecisionLevel, jitterEnabled = true) {
  const [state, setState] = useState<GeoState>({
    consent: 'unset',
    cellId: null,
    cellCenter: null,
    error: null,
  });
  const watchId = useRef<number | null>(null);

  const toCoarseCell = useCallback(
    (lat: number, lng: number): string => {
      let cell = coarsenToCell(lat, lng, precision);
      if (jitterEnabled) cell = jitterWithinCell(cell);
      return cell.cellId;
    },
    [precision, jitterEnabled],
  );

  const start = useCallback(() => {
    if (!geoSupported()) {
      setState((s) => ({ ...s, consent: 'unavailable', error: 'Geolocation is not supported here.' }));
      return;
    }
    setState((s) => ({ ...s, error: null }));
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const cellId = toCoarseCell(pos.coords.latitude, pos.coords.longitude);
        setState({
          consent: 'granted',
          cellId,
          cellCenter: decodeGeohash(cellId).center,
          error: null,
        });
      },
      (err) => {
        setState((s) => ({
          ...s,
          consent: err.code === err.PERMISSION_DENIED ? 'denied' : s.consent,
          error: err.message,
        }));
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
    );
  }, [toCoarseCell]);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setState((s) => ({ ...s, cellId: null, cellCenter: null }));
  }, []);

  useEffect(() => stop, [stop]);

  return { state, start, stop };
}

/**
 * Fallback picker: user taps a spot on the map (Leaflet) to choose their own
 * coarse location — no GPS permission needed.
 */
export function cellFromLatLng(lat: number, lng: number, precision: GeoPrecisionLevel): string {
  return encodeGeohashN(lat, lng, precision === 'reduced' ? 5 : 6);
}

export interface ReverseGeo {
  label: string;
}

/** Privacy-preserving reverse geocode: uses Nominatim with the COARSED cell center only. */
export async function reverseGeocodeCellCenter(lat: number, lng: number): Promise<ReverseGeo> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error('geocode failed');
    const body = (await res.json()) as { display_name?: string };
    const parts = (body.display_name ?? '').split(', ').slice(0, 3);
    return { label: parts.join(', ') || 'Unknown area' };
  } catch {
    return { label: 'Unknown area' };
  }
}
