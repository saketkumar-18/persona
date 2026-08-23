'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import type { StoredGhostSession } from '../lib/storage';
import { pushToast } from './toast';

interface QrHostProps {
  session: StoredGhostSession;
  onPaired: (roomId: string, partner: { id: string; alias: string; emoji: string }) => void;
}

/**
 * Shows a QR code the other person can scan to join instantly. The code
 * expires in 5 minutes and is single-use (enforced server-side). Below the
 * code we also render the raw value so nearby users can type it manually.
 */
export default function QrHost({ session, onPaired }: QrHostProps) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [svg, setSvg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const makeCode = useCallback(async () => {
    try {
      const res = await api.createQr(session.token);
      if (!res.code) {
        pushToast('QR limit reached — try again later.');
        return;
      }
      setCode(res.code);
      setExpiresAt(res.expiresAt);
      // Payload = deep link the scanner's client redeems via /join?code=…
      const payload = `${window.location.origin}/join?code=${encodeURIComponent(res.code)}`;
      setSvg(await QRCode.toString(payload, { type: 'svg', margin: 1, width: 220 }));
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'failed to create QR code');
    }
  }, [session.token]);

  useEffect(() => {
    void makeCode();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [makeCode]);

  // countdown
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        setCode(null);
        setSvg('');
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  // long-poll for redemption via /qr/redeem is NOT done here — the redeeming
  // client POSTs; the server pushes `match:found` to us over the socket. We
  // do however poll GET-less: simply wait for onPaired from the socket layer.
  // (Kept minimal on purpose; no personal data is exchanged.)
  useEffect(() => {
    if (!code) return;
    pollRef.current = setInterval(() => {
      void api.getSession(session.token).catch(() => {
        if (pollRef.current) clearInterval(pollRef.current);
      });
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [code, session.token]);

  return (
    <div className="card mx-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center animate-fade-up">
      <h3 className="font-bold">Show this QR to connect instantly</h3>
      {svg ? (
        <div
          className="rounded-xl bg-white p-2"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">
          {code === null && expiresAt === null ? 'expired' : 'generating…'}
        </div>
      )}
      {code && (
        <p className="font-mono text-xs tracking-widest text-[var(--muted)]">{code}</p>
      )}
      {remaining !== null && code && (
        <span className="chip">⏱ expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>
      )}
      {!code && (
        <button type="button" className="btn-primary" onClick={() => void makeCode()}>
          🔄 New code
        </button>
      )}
      <p className="text-xs text-[var(--muted)]">
        Single-use · auto-expires in 5 minutes · contains no personal data
      </p>
    </div>
  );
}
