'use client';

import { useCallback, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { api } from '../lib/api';
import type { StoredGhostSession } from '../lib/storage';
import { pushToast } from './toast';

interface QrScannerProps {
  session: StoredGhostSession;
  onPaired: (roomId: string, partner: { id: string; alias: string; emoji: string }) => void;
}

/**
 * QR + manual-code scanner. Uses getUserMedia when available; otherwise the
 * user types the 6-char code manually (full fallback, no Bluetooth/camera
 * dependency). Scanned payloads are parsed locally — only the short pairing
 * code is ever sent to the server.
 */
export default function QrScanner({ session, onPaired }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const redeem = useCallback(
    async (code: string) => {
      const clean = code.trim().toLowerCase();
      const match = /(?:^|code=)(ql_[a-z2-9]{6})/.exec(clean);
      const pairingCode = match?.[1];
      if (!pairingCode) {
        pushToast('That does not look like a Persona pairing code.');
        return;
      }
      try {
        const res = await api.redeemQr(session.token, pairingCode);
        if (res.ok && res.roomId && res.partner) {
          onPaired(res.roomId, res.partner);
        } else {
          pushToast('Code invalid, expired, or already used.');
        }
      } catch (e) {
        pushToast(e instanceof Error ? e.message : 'redeem failed');
      }
    },
    [session.token, onPaired],
  );

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera not available — type the code instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        const video = videoRef.current;
        if (video && ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (found?.data) {
            stopCamera();
            void redeem(found.data);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setScanning(false);
      setCameraError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera permission denied — type the code instead.'
          : 'Camera unavailable — type the code instead.',
      );
    }
  }, [redeem, stopCamera]);

  return (
    <div className="card mx-auto w-full max-w-sm p-6 animate-fade-up">
      <h3 className="text-center font-bold">Scan a Persona QR</h3>
      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
        <video ref={videoRef} className={scanning ? 'w-full' : 'hidden'} playsInline muted />
        {!scanning && (
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-sm text-[var(--muted)]">
            <span aria-hidden className="animate-floaty text-3xl">📷</span>
            {cameraError ?? 'Camera preview appears here'}
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {scanning ? (
          <button type="button" className="btn-ghost" onClick={stopCamera}>
            Stop camera
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => void startCamera()}>
            📷 Start camera scan
          </button>
        )}
        <div className="flex gap-2">
          <input
            className="input font-mono text-sm"
            placeholder="or paste code…"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            aria-label="Pairing code"
          />
          <button type="button" className="btn-ghost" onClick={() => void redeem(manual)} disabled={!manual.trim()}>
            Join
          </button>
        </div>
        <p className="text-xs text-[var(--muted)]">
          Camera processing happens 100% on your device — only the pairing code is sent.
        </p>
      </div>
    </div>
  );
}
