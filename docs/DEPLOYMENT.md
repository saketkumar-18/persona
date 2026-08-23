# GhostLink Deployment Guide

## Local development
```bash
npm install
npm run dev          # API:3000, web:3001, in-memory store (no Redis needed)
```
Point two browser tabs at `http://localhost:3001/ghost` to try matching between ghosts.

## Docker Compose (recommended for staging/production)
```bash
cp .env.example .env        # REQUIRED: set strong secrets below
npm run docker:up
```
Services: `redis:7-alpine` (healthchecked), `server` (NestJS), `web` (Next.js).
Manage with `npm run docker:down` / `npm run docker:logs`.

## Required production environment

| Variable | Notes |
| --- | --- |
| `SESSION_JWT_SECRET` | ≥ 32 chars, unique per deployment. Random-generated per boot if unset (sessions die on restart — acceptable for GhostLink, configurable if you want restart-surviving sessions). |
| `PARTNER_CONTROL_SECRET` | Random ≥ 32 chars |
| `REDIS_URL` | `redis://:password@host:6379` |
| `ALLOWED_ORIGINS` | Comma list of web origins for CORS, e.g. `https://app.example.com` |
| `METRICS_TOKEN` | Optional ≥16-char token gating `/api/metrics` |
| `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` | Public browser-facing URLs (wss:// for WS in prod) |

All other variables have safe defaults (see `.env.example`).

### Generating strong secrets
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Never commit real secrets. `.env` is gitignored; `.env.example` ships safe placeholders only.

## Reverse proxy / TLS
Terminate TLS at your edge (nginx/caddy/ALB). GhostLink requires:
- WebSocket upgrade support for `/socket.io` (`Upgrade: websocket`).
- No long body buffering for WS frames.
Example nginx location:
```nginx
location /socket.io/ {
  proxy_pass http://server:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```
Bluetooth discovery and camera QR scanning require a **secure context** (HTTPS on a non-
localhost origin).

## Scaling
- The API is stateless when backed by Redis; run multiple `server` replicas behind a balancer.
  Socket.IO sticky sessions are not required because room state lives in Redis and events are
  emitted per-replica; for multi-node realtime fan-out add `socket.io-redis` adapter.
- `web` is a static-first Next.js app; scale independently or front it with a CDN.
- Redis: persistence is unnecessary and disabled (appendonly off) — data is ephemeral by
  design. Size it for a few hundred MB.

## Health, metrics, monitoring
- `GET /api/health` for liveness/readiness probes.
- `GET /api/metrics` (Prometheus) — scrape with a token header if `METRICS_TOKEN` set.
- Key alerts: 5xx rate on `/api/*`, Redis connectivity (`redis` field in `/api/health`),
  queue depth from `ghostlink_match_queue_size{kind=…}`.

## CI/CD
`.github/workflows/ci.yml` runs, on every push/PR:
- Server: lint (typecheck), unit + e2e tests (Redis service container)
- Web: typecheck, Vitest, production build
- Docker image builds (no push)
Extend the workflow with your registry push + deploy steps. Current pipeline is
build+test+image; it intentionally does not ship credentials.

## Pre-launch checklist
- [ ] `SESSION_JWT_SECRET`, `PARTNER_CONTROL_SECRET`, `METRICS_TOKEN` set (strong, unique)
- [ ] `REDIS_URL` reachable; TLS/ACLs if shared
- [ ] `ALLOWED_ORIGINS` restricted to your domains
- [ ] HTTPS + WebSocket upgrade working at the edge
- [ ] Backup is **not** configured — confirm that ephemeral-by-design is the accepted policy
- [ ] Rate limits tuned to expected load (`@nestjs/throttler` in `app.module.ts`)
