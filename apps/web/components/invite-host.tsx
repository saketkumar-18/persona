'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import type { StoredGhostSession } from '../lib/storage';
import { pushToast } from './toast';

interface InviteHostProps {
  session: StoredGhostSession;
  onPaired: (roomId: string, partner: { id: string; alias: string; emoji: string }) => void;
}

/**
 * Invite links — reconnect with the same person later.
 *
 * Create a link (random or custom slug), share it however you like. When the
 * other person opens it they land in the same private room. The link expires
 * with the room TTL and is rate-limited per session. Pairing itself arrives
 * over the socket as `match:found` (handled by the dashboard).
 */
export default function InviteHost({ session }: InviteHostProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [svg, setSvg] = useState('');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const makeInvite = useCallback(
    async (customSlug?: string) => {
      setBusy(true);
      try {
        const res = await api.createInvite(session.token, customSlug);
        if (!res.slug || !res.url) {
          pushToast(
            customSlug
              ? 'That name is taken or invalid — try another.'
              : 'Invite limit reached — try again later.',
          );
          return;
        }
        setSlug(res.slug);
        setUrl(res.url);
        setExpiresAt(res.expiresAt);
        setSvg(await QRCode.toString(res.url, { type: 'svg', margin: 1, width: 200 }));
      } catch (e) {
        pushToast(e instanceof Error ? e.message : 'failed to create invite');
      } finally {
        setBusy(false);
      }
    },
    [session.token],
  );

  useEffect(() => {
    void makeInvite();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [makeInvite]);

  // countdown
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        setUrl(null);
        setSlug(null);
        setSvg('');
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  // keep-alive poll so the session (and thus the invite room) stays warm
  useEffect(() => {
    if (!url) return;
    pollRef.current = setInterval(() => {
      void api.getSession(session.token).catch(() => {
        if (pollRef.current) clearInterval(pollRef.current);
      });
    }, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [url, session.token]);

  const copy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast('Copy failed — long-press the link instead.');
    }
  }, [url]);

  return (
    <div className="card mx-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center animate-fade-up">
      <h3 className="font-bold">Invite link — talk to the same person again</h3>
      {svg ? (
        <div
          className="rounded-xl bg-white p-2"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex h-48 w-48 items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">
          {url === null && expiresAt === null ? 'expired' : 'generating…'}
        </div>
      )}
      {url && (
        <>
          <p className="w-full break-all rounded-lg bg-[var(--surface)] px-3 py-2 font-mono text-xs">
            {url}
          </p>
          <div className="flex w-full gap-2">
            <button type="button" className="btn-primary flex-1" onClick={() => void copy()}>
              {copied ? '✅ Copied!' : '📋 Copy link'}
            </button>
            <button
              type="button"
              className="btn-ghost flex-1"
              disabled={busy}
              onClick={() => void makeInvite()}
            >
              🔄 New link
            </button>
          </div>
        </>
      )}
      {remaining !== null && url && (
        <span className="chip">
          ⏱ expires in {Math.floor(remaining / 3600)}h {Math.floor((remaining % 3600) / 60)}m
        </span>
      )}
      {!url && (
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void makeInvite()}
        >
          🔄 New link
        </button>
      )}
      <div className="flex w-full gap-2">
        <input
          type="text"
          className="input flex-1 font-mono text-xs"
          placeholder="custom-name-42 (optional)"
          value={custom}
          maxLength={32}
          onChange={(e) => setCustom(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
        />
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={busy || custom.length < 3}
          onClick={() => void makeInvite(custom)}
        >
          Use name
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Share the link any way you like. When they open it, you&apos;re paired into the same private
        room. The slug is the secret — anyone with it can join, so only share it with your person.
      </p>
    </div>
  );
}
