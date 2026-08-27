'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'persona:install-hint-dismissed';

/**
 * Installable-PWA hint.
 * - Shows only when the browser fires `beforeinstallprompt` (i.e. installable).
 * - The ✕ / "Not now" arrow hides it for good (persisted in localStorage) —
 *   it must never re-appear after dismissal on the same device.
 * - Hidden automatically once the app is actually installed (standalone mode).
 */
export default function PwaInstallHint() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true); // default hidden until we know better

  useEffect(() => {
    // Already installed as an app? Never show the banner.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;

    let stored = false;
    try {
      stored = window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      /* private mode — treat as not dismissed */
    }
    setDismissed(stored);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted' || choice === null) dismiss();
    else dismiss();
    setPromptEvent(null);
  };

  if (!promptEvent || dismissed) return null;

  return (
    <div className="card fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-3 animate-fade-up">
      <span aria-hidden>📲</span>
      <p className="text-sm">
        Install Persona for quick access — no account, nothing tracked.
      </p>
      <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => void install()}>
        Install
      </button>
      {/* Dismissal control: chevron + close, both hide permanently */}
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
        onClick={dismiss}
        aria-label="Hide install suggestion"
        title="Hide"
      >
        ▾ <span className="hidden sm:inline">Not now</span>
      </button>
      <button
        type="button"
        className="text-xs leading-none text-[var(--muted)] hover:text-[var(--fg)]"
        onClick={dismiss}
        aria-label="Close install prompt"
      >
        ✕
      </button>
    </div>
  );
}
