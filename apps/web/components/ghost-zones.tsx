'use client';

import { useCallback, useEffect, useState } from 'react';
import { decodeGeohash } from '@ghostlink/shared';
import { api } from '../lib/api';
import { cellFromLatLng, reverseGeocodeCellCenter } from '../lib/geo';
import type { StoredGhostSession } from '../lib/storage';
import { pushToast } from './toast';

interface GhostZonesProps {
  session: StoredGhostSession;
  /** Start zone matching over the socket (sets zoneCell filter). */
  onEnterZone: (cellId: string, label: string) => void;
}

/**
 * Ghost Zones — Event & Travel Mode.
 * A zone is just a coarse geohash cell: everyone in the zone can be matched
 * together. Event mode: pin your current cell. Travel mode: type any address
 * (geocoded via Nominatim with coarse center only) and pin that cell instead.
 */
export default function GhostZones({ session, onEnterZone }: GhostZonesProps) {
  const [travelQuery, setTravelQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoneLabel, setZoneLabel] = useState<string | null>(null);
  const [zoneCell, setZoneCell] = useState<string | null>(null);

  const enterCurrentCell = useCallback(async () => {
    if (!('geolocation' in navigator)) {
      pushToast('Geolocation unavailable — use travel search instead.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coarse = cellFromLatLng(pos.coords.latitude, pos.coords.longitude, 'reduced');
        const geo = await reverseGeocodeCellCenter(
          decodeGeohash(coarse).center.lat,
          decodeGeohash(coarse).center.lng,
        );
        try {
          const res = await api.enterGhostZone(session.token, coarse);
          setZoneCell(res.zone.cellId);
          setZoneLabel(`${geo.label} (${res.activeSessions} others here)`);
          onEnterZone(res.zone.cellId, geo.label);
        } catch (e) {
          pushToast(e instanceof Error ? e.message : 'zone join failed');
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setBusy(false);
        pushToast(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  }, [session.token, onEnterZone]);

  const travel = useCallback(async () => {
    const q = travelQuery.trim();
    if (!q) return;
    setBusy(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) throw new Error('geocode failed');
      const results = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      const first = results[0];
      if (!first) {
        pushToast('No matching place found.');
        return;
      }
      const coarse = cellFromLatLng(Number(first.lat), Number(first.lon), 'reduced');
      const zone = await api.enterGhostZone(session.token, coarse);
      setZoneCell(zone.zone.cellId);
      setZoneLabel(`${first.display_name.split(',').slice(0, 2).join(',')} (${zone.activeSessions} others)`);
      onEnterZone(zone.zone.cellId, first.display_name.split(',')[0] ?? 'Travel zone');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'travel search failed');
    } finally {
      setBusy(false);
    }
  }, [travelQuery, session.token, onEnterZone]);

  return (
    <div className="card space-y-4 p-4 animate-fade-up">
      <div>
        <h3 className="font-bold">🌫️ Ghost Zones</h3>
        <p className="text-xs text-[var(--muted)]">
          Join a coarse location bucket to match people in the same zone — event mode (you are
          there) or travel mode (you want to be there).
        </p>
      </div>

      <button
        type="button"
        className="btn-primary w-full"
        onClick={() => void enterCurrentCell()}
        disabled={busy}
      >
        📍 Event mode: zone at my location
      </button>

      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Travel mode: city or place…"
          value={travelQuery}
          onChange={(e) => setTravelQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void travel();
          }}
        />
        <button type="button" className="btn-ghost" onClick={() => void travel()} disabled={busy || !travelQuery.trim()}>
          ✈️ Go
        </button>
      </div>

      {zoneCell && zoneLabel && (
        <div className="rounded-xl bg-[var(--accent-soft)] p-3 text-sm animate-fade-up">
          <p className="font-medium">Zone active: {zoneLabel}</p>
          <p className="text-xs text-[var(--muted)]">
            Matching pool limited to this coarse cell · exact coordinates never shared
          </p>
        </div>
      )}
    </div>
  );
}
