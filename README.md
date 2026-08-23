# 👻 GhostLink

**Privacy-first social discovery and real-time communication platform — no accounts, ever.**

GhostLink lets people connect with nearby users or random matches anywhere in the world
without registration, profiles, or persistent data. Sessions are ephemeral tokens; chats are
end-to-end encrypted and self-destruct; location is coarsened on-device before it ever leaves
the browser.

![CI](https://github.com/saketkumar-18/GhostLink/actions/workflows/ci.yml/badge.svg)

## Deploy in one click (free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/new?snippet=https://github.com/saketkumar-18/GhostLink/blob/master/render.yaml)

Backend + Redis land automatically. See [docs/DEPLOY_FREE.md](docs/DEPLOY_FREE.md) for the Vercel frontend steps.

## Why GhostLink

| Feature | How it stays private |
| --- | --- |
| **No login / no registration** | A session IS an ephemeral JWT. Create it with one tap; it dies on expiry or tab close. |
| **Anonymous identities** | Random ghost alias + emoji. Change or burn them any time. |
| **Nearby GPS discovery** | Raw coordinates are coarsened into geohash cells **on-device**; the server only sees cells. |
| **Global random matching** | FIFO queue, oldest-first, blocklist-aware — queue holds ids only, never payloads. |
| **QR instant connect** | Single-use, 5-minute pairing codes. Camera decoding runs 100% locally. |
| **Bluetooth discovery** | Optional presence beacon with graceful fallback where Web Bluetooth is unavailable. |
| **Ghost Zones / Event / Travel mode** | Match pools scoped to a coarse location cell. |
| **Self-destructing chat rooms** | TTL-bounded, zero message persistence, wipes on close. |
| **Encrypted communication** | Per-room AES-256-GCM keys from ephemeral ECDH P-256; server relays ciphertext only. |
| **Block & Report** | Immediate mutual-silent blocking; hashed-only report notes with rate limits. |

## Stack

- **Frontend**: Next.js 15 (App Router) · React 19 · Tailwind CSS · Leaflet maps · PWA (manifest + service worker) · dark/light themes
- **Backend**: NestJS 10 · Socket.IO (realtime plane) · REST control plane with Swagger docs
- **State**: Redis (ephemeral by design; automatic in-memory fallback for dev)
- **Infra**: Docker Compose · GitHub Actions CI · Prometheus metrics · health checks

## Quick start

```bash
# 1) install
npm install

# 2) run API + web for development (ports 3000 / 3001)
npm run dev

# 3) open
#  web:  http://localhost:3001
#  api:  http://localhost:3000/docs       (Swagger UI)
```

No Redis? No problem — the server falls back to an in-memory store (dev default).
For real Redis:

```bash
docker compose up -d redis
# then set REDIS_URL=redis://localhost:6379
```

### Docker (one command)

```bash
cp .env.example .env   # edit secrets!
npm run docker:up      # builds + starts redis, server, web
```

## Monorepo layout

```
GhostLink/
├── apps/
│   ├── server/       # NestJS API + Socket.IO realtime gateway
│   └── web/          # Next.js PWA
├── packages/
│   └── shared/       # types, WS protocol, E2E crypto, geo privacy utils
├── docker/           # Dockerfiles (server, web)
├── docs/             # ARCHITECTURE, PRIVACY, API, DEPLOYMENT
└── scripts/          # PWA icon generator (sharp)
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + web in parallel |
| `npm run build` | Build all workspaces (shared → server → web) |
| `npm test` | All test suites (vitest + jest, incl. e2e) |
| `npm run lint` / `npm run typecheck` | Static checks across workspaces |
| `npm run generate-icons` | Regenerate PWA icons from `apps/web/public/logo.svg` |
| `npm run docker:up` / `down` / `logs` | Compose lifecycle |

## Phased delivery map

- **Phase 1 — MVP** ✅ anonymous sessions · random matching · encrypted ephemeral chat ·
  GPS discovery · block/report · responsive PWA
- **Phase 2 — Advanced** ✅ Bluetooth discovery (graceful fallback) · QR instant connect ·
  Ghost Zones · Event Mode · Travel Mode · enhanced matching · session safety codes
- **Phase 3 — Hardening** ✅ security review · rate limiting · abuse prevention · automated
  tests · CI/CD · Docker · monitoring/metrics · full documentation

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — planes, data flow, Redis schema, E2E crypto model
- [Privacy & Threat Model](docs/PRIVACY.md) — what we hold, what we can't, honest limits
- [API reference](docs/API.md) — every REST endpoint + WS events
- [Deployment](docs/DEPLOYMENT.md) — production checklist, scaling, ops runbook

## License

MIT — see [LICENSE](LICENSE).
