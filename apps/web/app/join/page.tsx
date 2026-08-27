'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useSessionManager } from '../../lib/session';
import { api } from '../../lib/api';
import ToastHost from '../../components/toast';
import { pushToast } from '../../components/toast';

/**
 * /join — destination of both QR deep links (?code=ql_xxxxxx) and invite
 * links (?slug=cozy-forest-42). Requires an active session; creates one
 * first if none exists, then redeems/joins and routes to the chat.
 */
function JoinPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params?.get('code') ?? '';
  const slug = params?.get('slug') ?? '';
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
      // Invite link (?slug=…) joins a named room; QR link (?code=…) redeems a
      // single-use pairing code. Both land in the same chat flow.
      const res = slug
        ? await api.joinInvite(active.token, slug)
        : await api.redeemQr(active.token, code);
      if (res.ok && res.roomId && res.partner) {
        setStatus('done');
        sessionStorage.setItem(
          'persona:joined-room',
          JSON.stringify({ roomId: res.roomId, partner: res.partner }),
        );
        router.push('/ghost');
      } else {
        setStatus('failed');
        pushToast(
          slug
            ? 'Invite invalid, expired, or already full.'
            : 'Code invalid, expired, or already used.',
        );
      }
    } catch (e) {
      setStatus('failed');
      pushToast(e instanceof Error ? e.message : 'join failed');
    }
  }, [code, slug, session, create, router]);

  useEffect(() => {
    if ((!code && !slug) || status !== 'waiting') return;
    if (state === 'active') void redeem();
    else if (state === 'none') {
      setStatus('creating');
      void create().then((s) => {
        if (s) void redeem();
        else setStatus('failed');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, code, slug, status]);

  const isInvite = Boolean(slug);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-4xl animate-floaty" aria-hidden>👻</span>
      {status === 'failed' ? (
        <>
          <h1 className="text-xl font-bold">Couldn’t join</h1>
          <p className="text-sm text-[var(--muted)]">
            {isInvite
              ? 'This invite link is invalid, expired, or the room is already full. Ask your ghost for a fresh link.'
              : 'The pairing code is invalid, expired, or already used. Ask your ghost for a fresh QR.'}
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
            {status === 'redeeming' && (isInvite ? 'Joining via invite link…' : 'Redeeming pairing code…')}
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
