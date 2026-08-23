'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type L from 'leaflet';

export interface MapMarkerItem {
  id: string;
  /** Cell-center lat — never raw GPS. */
  lat: number;
  lng: number;
  emoji: string;
  alias: string;
  distanceMeters?: number;
}

interface NearbyMapProps {
  center: { lat: number; lng: number } | null;
  me: boolean;
  markers: MapMarkerItem[];
  onPickCell: (lat: number, lng: number) => void;
  pickEnabled: boolean;
}

/**
 * Discovery map (Leaflet, OpenStreetMap tiles).
 * - Shows ONLY geohash cell centers (coarse), never raw coordinates.
 * - Optional tap-to-pick location as a GPS-free fallback.
 */
export default function NearbyMap({ center, me, markers, onPickCell, pickEnabled }: NearbyMapProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Layer[]>([]);
  const pickRef = useRef(onPickCell);
  pickRef.current = onPickCell;
  const pickEnabledRef = useRef(pickEnabled);
  pickEnabledRef.current = pickEnabled;

  useEffect(() => {
    let disposed = false;
    import('leaflet').then((leaflet) => {
      if (disposed || !divRef.current || mapRef.current) return;
      const map = leaflet
        .map(divRef.current, { zoomControl: true, attributionControl: true })
        .setView([center?.lat ?? 20, center?.lng ?? 0], center ? 13 : 2);
      leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 17,
        })
        .addTo(map);
      map.on('click', (e: L.LeafletMouseEvent) => {
        if (pickEnabledRef.current) pickRef.current(e.latlng.lat, e.latlng.lng);
      });
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 50);
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !center) return;
    mapRef.current.setView([center.lat, center.lng], 13, { animate: true });
  }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    import('leaflet').then((L) => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (center) {
        markersRef.current.push(
          L.circle([center.lat, center.lng], {
            radius: 1000,
            color: '#6d57d8',
            fillOpacity: 0.12,
          }).addTo(map),
        );
        if (me) {
          markersRef.current.push(
            L.marker([center.lat, center.lng]).bindTooltip('You (coarse)').addTo(map),
          );
        }
      }
      for (const item of markers) {
        markersRef.current.push(
          L.marker([item.lat, item.lng])
            .bindTooltip(
              `${item.emoji} ${item.alias}${
                item.distanceMeters !== undefined
                  ? ` · ~${(item.distanceMeters / 1000).toFixed(1)} km`
                  : ''
              }`,
            )
            .addTo(map),
        );
      }
    });
  }, [markers, center?.lat, center?.lng, me]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={divRef} className="h-64 w-full rounded-2xl border border-[var(--border)]" aria-label="Discovery map" />;
}
