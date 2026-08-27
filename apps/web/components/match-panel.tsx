'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBluetoothBeacon, bluetoothSupport } from '../lib/bluetooth';
import { pushToast } from './toast';

interface MatchPanelProps {
  queued: boolean;
  queuedPosition: number | null;
  connected: boolean;
  zoneCell: string | null;
  onStartRandom: () => void;
  onStartNearby: () => void;
  onCancel: () => void;
}

/**
 * The main matching action panel: global random matching, zone-scoped
 * matching, Bluetooth presence beacon (optional, graceful fallback).
 */
export default function MatchPanel({
  queued,
  queuedPosition,
  connected,
  zoneCell,
  onStartRandom,
  onStartNearby,
  onCancel,
}: MatchPanelProps) {
  const btSupport = bluetoothSupport();
  const bt = useBluetoothBeacon();
  const btStop = useRef(bt.stop);
  btStop.current = bt.stop;
  const [btArmed, setBtArmed] = useState(false);

  const armBluetooth = useCallback(async () => {
    const ok = await bt.advertise();
    if (!ok) return;
    setBtArmed(true);
    pushToast('Bluetooth presence armed — peers scanning nearby may detect you.');
  }, [bt.advertise]);

  useEffect(() => () => {
    btStop.current();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!connected) {
    return (
      <div className="card p-6 text-center animate-fade-up">
        <p className="text-sm text-[var(--muted)]">Connecting to Persona…</p>
      </div>
    );
  }

  if (queued) {
    return (
      <div className="card relative overflow-hidden p-8 text-center animate-fade-up">
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="h-24 w-24 rounded-full border-2 border-[var(--accent)] animate-pulse-ring" />
        </div>
        <p className="relative animate-floaty text-4xl" aria-hidden>👻</p>
        <p className="relative mt-2 font-semibold">
          Searching for a ghost{zoneCell ? ` in your zone (${zoneCell})` : ' anywhere'}…
        </p>
        {queuedPosition !== null && queuedPosition > 1 && (
          <p className="relative mt-1 text-sm text-[var(--muted)]">
            {queuedPosition} ghosts waiting in the queue
          </p>
        )}
        <button type="button" className="btn-ghost relative mt-4" onClick={onCancel}>
          Cancel search
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-4">
      <button type="button" className="btn-primary w-full" onClick={onStartRandom}>
        🌍 Random match
        {zoneCell ? ' (zone)' : ''}
      </button>
      <button type="button" className="btn-ghost w-full" onClick={onStartNearby}>
        📍 Match nearby ghosts
      </button>

      <div className="border-t border-[var(--border)] pt-3">
        {btSupport.supported ? (
          btArmed ? (
            <div className="space-y-2 text-sm">
              <p>📶 Bluetooth presence: <strong>armed</strong></p>
              {bt.state.lastSignalAt && (
                <p className="text-xs text-[var(--muted)]">
                  Last peer signal {new Date(bt.state.lastSignalAt).toLocaleTimeString()}
                </p>
              )}
              <button
                type="button"
                className="btn-ghost w-full text-xs"
                onClick={() => void bt.scanNow().then((n) => pushToast(`${n} nearby device(s) signalled.`))}
              >
                Ping for nearby ghosts
              </button>
            </div>
          ) : (
            <button type="button" className="btn-ghost w-full text-xs" onClick={() => void armBluetooth()}>
              📶 Enable Bluetooth discovery (optional)
            </button>
          )
        ) : (
          <p className="text-xs text-[var(--muted)]">
            Bluetooth discovery isn’t supported here{btSupport.needsSecureContext ? ' (needs HTTPS)' : ''} — using
            internet-based discovery instead.
          </p>
        )}
      </div>
    </div>
  );
}
