'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useThemeToggle } from './theme-provider';

export default function NavBar({ connected }: { connected?: boolean }) {
  const toggle = useThemeToggle();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--card)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span aria-hidden className="text-xl">👻</span>
          GhostLink
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          {connected !== undefined && (
            <span className="chip" aria-live="polite">
              <span
                className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-400'}`}
              />
              {connected ? 'online' : 'offline'}
            </span>
          )}
          <Link href="/privacy" className="btn-ghost text-xs">
            Privacy
          </Link>
          <button
            type="button"
            onClick={() => {
              toggle();
              setIsDark((d) => !d);
            }}
            className="btn-ghost text-xs"
            aria-label="Toggle color theme"
          >
            {isDark ? '🌙' : '☀️'}
          </button>
        </nav>
      </div>
    </header>
  );
}
