'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { GHOST_EMOJIS } from '@persona/shared';
import { useSessionManager } from '../lib/session';
import { pushToast } from './toast';

/**
 * Lobby — the "no-account" onboarding. One tap creates an anonymous session
 * with a random ghost identity. Optional alias/emoji picker, all client-side.
 */
export default function GhostLobby() {
  const { create, state, error } = useSessionManager();
  const router = useRouter();
  const pathname = usePathname();
  const [alias, setAlias] = useState('');
  const [emoji, setEmoji] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // Landing page: once a session exists here, hand over to the dashboard.
  useEffect(() => {
    if (state === 'active' && pathname === '/') router.replace('/ghost');
  }, [state, pathname, router]);

  const start = useCallback(async () => {
    setBusy(true);
    const session = await create(alias || undefined, emoji || undefined);
    setBusy(false);
    if (session) {
      pushToast(`Session started — you are ${session.alias} ${session.emoji}`);
    } else if (error) {
      pushToast(error);
    }
  }, [alias, emoji, create, error]);

  return (
    <div className="card mx-auto w-full max-w-md p-6 animate-fade-up">
      <h2 className="text-lg font-bold">Become a ghost</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        No email, no phone, no profile. Your identity is ephemeral and dies with the tab.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="alias" className="text-xs font-medium text-[var(--muted)]">
            Alias (optional)
          </label>
          <input
            id="alias"
            className="input mt-1"
            placeholder="Random ghost name"
            maxLength={32}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
        </div>

        <div>
          <span className="text-xs font-medium text-[var(--muted)]">Emoji (optional)</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {GHOST_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className={`rounded-lg border p-1.5 text-lg transition ${
                  emoji === e
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                    : 'border-transparent hover:bg-[var(--accent-soft)]'
                }`}
                onClick={() => setEmoji(e === emoji ? '' : e)}
                aria-label={`Pick emoji ${e}`}
                aria-pressed={emoji === e}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => void start()}
          disabled={busy || state === 'starting'}
        >
          {busy || state === 'starting' ? 'Conjuring your ghost…' : '👻 Start anonymous session'}
        </button>

        <p className="text-xs text-[var(--muted)]">
          ⚠️ Anonymity is best-effort: your browser, network operator, and what you choose to
          share can still reveal you. Never share personal details.
        </p>
      </div>
    </div>
  );
}
