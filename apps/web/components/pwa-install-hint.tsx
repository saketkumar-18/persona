'use client';

import { useEffect, useState } from 'react';

interface DeferredPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export default function PwaInstallHint() {
  const [prompt, setPrompt] = useState<DeferredPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as DeferredPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!prompt || dismissed) return null;

  return (
    <div className="card fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-3 animate-fade-up">
      <span aria-hidden>📲</span>
      <p className="text-sm">
        Install GhostLink for quick access — no account, nothing tracked.
      </p>
      <button
        type="button"
        className="btn-primary px-3 py-1.5 text-xs"
        onClick={async () => {
          await prompt.prompt();
          setPrompt(null);
        }}
      >
        Install
      </button>
      <button
        type="button"
        className="text-xs text-[var(--muted)]"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss install prompt"
      >
        ✕
      </button>
    </div>
  );
}
