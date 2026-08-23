import Link from 'next/link';
import NavBar from '../components/nav-bar';
import PwaInstallHint from '../components/pwa-install-hint';
import GhostLobby from '../components/ghost-lobby';
import ToastHost from '../components/toast';

export default function LandingPage() {
  return (
    <>
      <NavBar />
      <ToastHost />
      <main>
        {/* hero */}
        <section className="hero-grid relative overflow-hidden">
          <div className="mx-auto grid max-w-5xl gap-8 px-4 py-16 md:grid-cols-2 md:py-24">
            <div className="animate-fade-up space-y-4">
              <span className="chip">🔒 privacy-first · zero accounts</span>
              <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">
                Meet ghosts,
                <br />
                not profiles.
              </h1>
              <p className="max-w-md text-[var(--muted)]">
                GhostLink connects people nearby or anywhere with anonymous, temporary sessions.
                End-to-end encrypted chats that self-destruct. No registration, no history, no
                personal data collection.
              </p>
              <ul className="space-y-1 text-sm text-[var(--muted)]">
                <li>✓ No accounts — a session is an ephemeral token</li>
                <li>✓ GPS discovery uses coarse geohash cells only</li>
                <li>✓ QR instant connect · Ghost Zones · Travel Mode</li>
                <li>✓ Installable PWA · dark & light themes</li>
              </ul>
            </div>
            <GhostLobby />
          </div>
        </section>

        {/* features */}
        <section className="border-t border-[var(--border)] bg-[var(--card)]">
          <div className="mx-auto grid max-w-5xl gap-4 px-4 py-12 md:grid-cols-3">
            {[
              {
                title: 'Anonymous by design',
                body: 'Random ghost identities. Sessions default to 4 hours and can be burned at any time — closing the tab does it automatically.',
                icon: '👻',
              },
              {
                title: 'Encrypted rooms',
                body: 'Chats are AES-256-GCM encrypted with per-room keys from an ephemeral ECDH exchange. The server only relays ciphertext.',
                icon: '🔐',
              },
              {
                title: 'Local-first discovery',
                body: 'Nearby discovery never sends raw GPS — coordinates are coarsened into map cells on your device first.',
                icon: '📍',
              },
            ].map((f) => (
              <div key={f.title} className="card p-5 animate-fade-up">
                <p className="text-2xl" aria-hidden>{f.icon}</p>
                <h3 className="mt-2 font-bold">{f.title}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-8 text-center text-xs text-[var(--muted)]">
          <p>
            GhostLink is anonymous, not invisible — protect yourself by never sharing personal
            details. <Link href="/privacy" className="underline">Privacy & limits</Link>
          </p>
          <p>Open source under MIT· v1.0.0</p>
        </footer>
      </main>
      <PwaInstallHint />
    </>
  );
}
