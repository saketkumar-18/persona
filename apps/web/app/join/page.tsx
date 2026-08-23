'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useSessionManager } from '../../lib/session';
import { api } from '../../lib/api';
import ToastHost from '../../components/toast';
import { pushToast } from '../../components/toast';

/**
 * /join?code=ql_xxxxxx — destination of scanned QR deep links.
 * Requires an active session; creates one first if none exists, then redeems
 * the pairing code and routes to the chat.
 */
function JoinPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params?.get('code') ?? '';
  const { state, session, create } = useSessionManager();
  const [status, setStatus] = useState<'waiting' | 'creating' | 'redeeming' | 'done' | 'failed'>(
    'waiting',
  );

  const redeem = useCallback(async () => {
    const active = session ?? (await create());
    if (!active) {
      setStatus('failed');
      return;
    }
    setStatus('redeeming');
    try {
      const res = await api.redeemQr(active.token, code);
      if (res.ok && res.roomId && res.partner) {
        setStatus('done');
        sessionStorage.setItem(
          'ghostlink:joined-room',
          JSON.stringify({ roomId: res.roomId, partner: res.partner }),
        );
        router.push('/ghost');
      } else {
        setStatus('failed');
        pushToast('Code invalid, expired, or already used.');
      }
    } catch (e) {
      setStatus('failed');
      pushToast(e instanceof Error ? e.message : 'join failed');
    }
  }, [code, session, create, router]);

  useEffect(() => {
    if (!code || status !== 'waiting') return;
    if (state === 'active') void redeem();
    else if (state === 'none') {
      setStatus('creating');
      void create().then((s) => {
        if (s) void redeem();
        else setStatus('failed');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, code, status]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-4xl animate-floaty" aria-hidden>👻</span>
      {status === 'failed' ? (
        <>
          <h1 className="text-xl font-bold">Couldn’t join</h1>
          <p className="text-sm text-[var(--muted)]">
            The pairing code is invalid, expired, or already used. Ask your ghost for a fresh QR.
          </p>
          <button type="button" className="btn-primary" onClick={() => router.push('/')}>
            Back home
          </button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold">Joining the room…</h1>
          <p className="text-sm text-[var(--muted)]">
            {status === 'creating' && 'Creating your anonymous session…'}
            {status === 'redeeming' && 'Redeeming pairing code…'}
            {status === 'waiting' && 'One moment…'}
          </p>
        </>
      )}
    </main>
  );
}

export default function JoinPage() {
  return (
    <>
      <ToastHost />
      <Suspense fallback={<span />}>
        <JoinPageInner />
      </Suspense>
    </>
  );
}
