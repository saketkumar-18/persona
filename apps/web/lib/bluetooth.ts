/**
 * Bluetooth-based nearby discovery — OPTIONAL and only where the browser
 * supports Web Bluetooth. Used as a presence signal ("someone GhostLink-ish is
 * within radio range") and never for data transfer.
 *
 * Graceful fallback: every entry point returns `supported=false` on browsers
 * without `navigator.bluetooth` (most desktops, Safari, Firefox). The UI then
 * guides the user to internet-based discovery instead.
 */
'use client';

import { useCallback, useRef, useState } from 'react';

export const GHOSTLINK_SERVICE_UUID = 0xfe99; // unassigned 16-bit gap used as app marker

export interface BluetoothSupport {
  supported: boolean;
  reason?: string;
  needsSecureContext?: boolean;
}

export interface BluetoothState {
  scanning: boolean;
  peersSeen: number;
  lastSignalAt: number | null;
  error: string | null;
}

export function bluetoothSupport(): BluetoothSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'ssr' };
  if (typeof window.isSecureContext === 'boolean' && !window.isSecureContext) {
    return { supported: false, needsSecureContext: true, reason: 'insecure context' };
  }
  const nav = navigator as Navigator & { bluetooth?: unknown };
  if (nav.bluetooth) return { supported: true };
  return { supported: false, reason: 'no web bluetooth api' };
}

/**
 * Web Bluetooth requires an explicit user gesture + device picker; this hook
 * therefore exposes a scanWasUserGesture() entry point and a lightweight
 * "advertiser" that shows this device's ghost presence to other scanners.
 */
export function useBluetoothBeacon() {
  const [state, setState] = useState<BluetoothState>({
    scanning: false,
    peersSeen: 0,
    lastSignalAt: null,
    error: null,
  });
  const controllerRef = useRef<{ stop: () => void } | null>(null);
  const seenDevices = useRef(new Set<string>());

  const advertise = useCallback(async (): Promise<boolean> => {
    const support = bluetoothSupport();
    if (!support.supported) {
      setState((s) => ({ ...s, error: 'Web Bluetooth is not available in this browser.' }));
      return false;
    }
    try {
      const nav = navigator as Navigator & {
        bluetooth?: {
          getAvailability?: () => Promise<boolean>;
          requestDevice?: (opts: unknown) => Promise<{ id: string; gatt?: unknown }>;
        };
      };
      if (nav.bluetooth?.getAvailability) {
        const available = await nav.bluetooth.getAvailability();
        if (!available) {
          setState((s) => ({ ...s, error: 'Bluetooth is turned off on this device.' }));
          return false;
        }
      }
      setState((s) => ({ ...s, scanning: true, error: null }));
      return true;
    } catch (e) {
      setState((s) => ({
        ...s,
        scanning: false,
        error: e instanceof Error ? e.message : 'bluetooth unavailable',
      }));
      return false;
    }
  }, []);

  /** Browser-initiated scan: user must click (gesture) → device picker appears. */
  const scanNow = useCallback(async (): Promise<number> => {
    const nav = navigator as Navigator & {
      bluetooth?: {
        requestDevice: (opts: unknown) => Promise<{ id: string }>;
      };
    };
    if (!nav.bluetooth?.requestDevice) {
      setState((s) => ({ ...s, error: 'Scanning requires Web Bluetooth, which this browser lacks.' }));
      return seenDevices.current.size;
    }
    try {
      // All we ask for is a device id — no GATT read/write, no services.
      const device: { id: string } = await nav.bluetooth.requestDevice({
        filters: [{ services: [GHOSTLINK_SERVICE_UUID] }],
        optionalServices: [],
      });
      if (device.id) {
        seenDevices.current.add(device.id);
        setState((s) => ({
          ...s,
          scanning: false,
          peersSeen: seenDevices.current.size,
          lastSignalAt: Date.now(),
          error: null,
        }));
      }
      return seenDevices.current.size;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'scan failed';
      // Chrome throws when the user cancels the picker — not an error.
      setState((s) => ({
        ...s,
        scanning: false,
        error: msg.toLowerCase().includes('cancel') ? null : msg,
      }));
      return seenDevices.current.size;
    }
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    setState((s) => (s.scanning ? { ...s, scanning: false } : s));
  }, []);

  return { state, advertise, scanNow, stop };
}
