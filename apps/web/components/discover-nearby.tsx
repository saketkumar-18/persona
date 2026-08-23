'use client';

import { useCallback, useEffect, useState } from 'react';
import { NearUser, decodeGeohash } from '@ghostlink/shared';
import { api } from '../lib/api';
import { cellFromLatLng } from '../lib/geo';
import type { StoredGhostSession } from '../lib/storage';
import NearbyMap, { MapMarkerItem } from './nearby-map';
import { pushToast } from './toast';

interface DiscoverNearbyProps {
  session: StoredGhostSession;
  /** Called when the user starts a chat with a nearby session (QR pairing). */
  onConnect: (user: NearUser) => void;
}

/**
 * GPS-based discovery UI. Coordinates are coarsened to a geohash cell
 * on-device; the API only receives the cell id. Server returns coarse
 * cell-center positions only.
 */
export default function DiscoverNearby({ session, onConnect }: DiscoverNearbyProps) {
  const [gpsCenter, setGpsCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [cellId, setCellId] = useState<string | null>(null);
  const [users, setUsers] = useState<NearUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [watchId, setWatchId] = useState<number | null>(null);

  const refresh = useCallback(
    async (cell: string) => {
      setLoading(true);
      try {
        const res = await api.nearby(session.token, cell);
        setUsers(res.users);
        setCellId(res.cellId);
      } catch (e) {
        pushToast(e instanceof Error ? e.message : 'Discovery failed');
      } finally {
        setLoading(false);
      }
    },
    [session.token],
  );

  const startGps = useCallback(() => {
    if (!('geolocation' in navigator)) {
      pushToast('Geolocation is not available — use the map picker instead.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const cell = cellFromLatLng(pos.coords.latitude, pos.coords.longitude, 'standard');
        setGpsCenter(decodeGeohash(cell).center);
        setCellId(cell);
        void refresh(cell);
      },
      (err) => pushToast(`GPS unavailable: ${err.message}`),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
    );
    setWatchId(id);
  }, [refresh]);

  const stopGps = useCallback(() => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null);
    setGpsCenter(null);
    setCellId(null);
    setUsers([]);
  }, [watchId]);

  useEffect(() => stopGps, [stopGps]); // eslint-disable-line react-hooks/exhaustive-deps

  const markers: MapMarkerItem[] = users.map((u) => {
    // Marker uses cell center derived from the user's coarse cell only.
    const center = gpsCenter ?? { lat: 0, lng: 0 };
    const lat = center.lat + (u.bearingDeg !== null ? 0.01 : 0);
    const lng = center.lng + 0.01;
    return {
      id: u.session.id,
      lat: center.lat + (u.distanceMeters / 111_000) * Math.cos(((u.bearingDeg ?? 0) * Math.PI) / 180),
      lng: center.lng + (u.distanceMeters / 111_000) * Math.sin(((u.bearingDeg ?? 0) * Math.PI) / 180),
      emoji: u.session.emoji,
      alias: u.session.alias,
      distanceMeters: u.distanceMeters,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {watchId === null ? (
          <button type="button" className="btn-primary" onClick={startGps}>
            📍 Enable GPS discovery
          </button>
        ) : (
          <button type="button" className="btn-danger" onClick={stopGps}>
            Stop GPS
          </button>
        )}
        <span className="chip">{users.length} nearby</span>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Tip: tap the map to set a coarse location manually (GPS-free).
      </p>

      <NearbyMap
        center={gpsCenter}
        me={cellId !== null}
        markers={markers}
        pickEnabled
        onPickCell={(lat, lng) => {
          const cell = cellFromLatLng(lat, lng, 'standard');
          setGpsCenter(decodeGeohash(cell).center);
          setCellId(cell);
          void refresh(cell);
        }}
      />

      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.session.id} className="card flex items-center justify-between p-3 animate-fade-up">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{u.session.emoji}</span>
              <div>
                <p className="font-medium">{u.session.alias}</p>
                <p className="text-xs text-[var(--muted)]">
                  ~{(u.distanceMeters / 1000).toFixed(1)} km{u.travel ? ' · travel mode' : ''}
                </p>
              </div>
            </div>
            <button type="button" className="btn-primary px-3 py-2 text-xs" onClick={() => onConnect(u)}>
              Connect
            </button>
          </li>
        ))}
      </ul>
      {loading && <p className="text-sm text-[var(--muted)]">Scanning nearby cells…</p>}
    </div>
  );
}
