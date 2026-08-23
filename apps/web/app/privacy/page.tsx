import NavBar from '../../components/nav-bar';

export const metadata = { title: 'Privacy — GhostLink' };

const SECTIONS: Array<{ title: string; points: string[] }> = [
  {
    title: 'What we never collect',
    points: [
      'Names, emails, phone numbers, or any account identifiers',
      'Chat content — rooms are end-to-end encrypted and never persisted',
      'Permanent profiles — a session dies when it expires or when the tab closes',
    ],
  },
  {
    title: 'What is temporarily held (and for how long)',
    points: [
      'Session id + ephemeral token in memory/Redis (max 24h, default 4h)',
      'A COARSE geohash cell of your location only when you enable GPS discovery',
      'Block/report counters that expire within 24h; report notes are hashed, not stored as text',
      'Match queue entries for the few seconds it takes to pair two ghosts',
    ],
  },
  {
    title: 'Location privacy',
    points: [
      'Raw GPS never leaves your device — it is coarsened into a geohash cell client-side',
      'Nearby users see cell-center positions at most, never exact coordinates',
      'Revoking permission or switching tabs stops all location use immediately',
    ],
  },
  {
    title: 'Chat security model',
    points: [
      'Per-room AES-256-GCM keys derived from ephemeral ECDH P-256 key exchange',
      'Private keys exist only in your browser session and are destroyed with the tab',
      'Compare "safety codes" (public-key fingerprints) in chat for out-of-band verification',
      'Limitation: pairing is server-mediated, so a compromised server could substitute keys — safety codes mitigate this',
    ],
  },
  {
    title: 'Moderation without surveillance',
    points: [
      'No automated content scanning of encrypted traffic — by design, we cannot read it',
      'Reports are rate-limited counters + hashed notes reviewed only when escalated',
      'Blocking is immediate, mutual-silent, and expires with the session',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-extrabold">Privacy & honest limits</h1>
        <p className="mt-2 text-[var(--muted)]">
          Privacy by design means telling you exactly what happens — including the limits of
          anonymity. Last updated 2026-08-23.
        </p>
        <div className="mt-8 space-y-6">
          {SECTIONS.map((s) => (
            <section key={s.title} className="card p-5">
              <h2 className="font-bold">{s.title}</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </section>
          ))}
          <section className="card border-amber-300/50 bg-amber-50 p-5 dark:border-amber-700/50 dark:bg-amber-950/30">
            <h2 className="font-bold">⚠️ Anonymity is best-effort</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              GhostLink minimizes data, but anonymity is never absolute: your ISP or network admin
              can see that you use the service, your device can be fingerprinted by the browser,
              and anything you type in chat is shared with your partner. Never share personal
              details — and report anyone who asks for money, identities, or intimate content.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
