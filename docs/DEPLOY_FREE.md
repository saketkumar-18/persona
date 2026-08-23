# GhostLink — Free Deployment Guide ($0, no credit card)

This stack runs GhostLink in production completely free:

| Piece | Provider (free tier) | Cost |
| --- | --- | --- |
| Web frontend (Next.js PWA) | **Vercel** Hobby | free |
| Backend (NestJS + Socket.IO, Docker) | **Render** free instance | free |
| Data store (Redis) | Render free Redis *or* in-memory fallback | free |

All data in GhostLink is ephemeral and TTL-bounded, so the free-tier Redis (or the
built-in memory fallback) is fully sufficient — nothing needs durability.

---

## 1) Push the code to GitHub

```bash
gh auth login            # one-time: GitHub account → web or CLI flow
gh repo create ghostlink --public --source=. --push
# or if the repo already exists:
git remote add origin https://github.com/<you>/ghostlink.git
git push -u origin main
```

---

## 2) Backend on Render (free web service)

**Option A — one-click Blueprint:**

Visit https://render.com/docs/deploy-to-render (or: Render → New → **Blueprint**),
point it at your `ghostlink` repo. `render.yaml` provisions:

- `ghostlink-api` — Docker web service (free plan), health check `/api/health`
- `ghostlink-redis` — free Redis, wired automatically into `REDIS_URL`
- `SESSION_JWT_SECRET` / `PARTNER_CONTROL_SECRET` auto-generated as Render secrets

Then fix the CORS allowlist for your actual frontend URL:
Render → `ghostlink-api` → Environment → set
`ALLOWED_ORIGINS=https://<your-vercel-app>.vercel.app` (add any custom domain too).

**Option B — manual:**

1. Render → New → Web Service → pick repo, branch `main`
2. Runtime: **Docker**, Dockerfile path: `docker/Dockerfile.server`
3. Plan: **Free**
4. Add env vars:
   - `SESSION_JWT_SECRET` (long random string, e.g. `openssl rand -hex 48`)
   - `PARTNER_CONTROL_SECRET` (same idea)
   - `ALLOWED_ORIGINS=https://<your-vercel-app>.vercel.app`
   - `REDIS_URL` (optional — from Render Redis, Upstash, or leave empty for memory fallback)
5. Health check path: `/api/health`

Render injects `$PORT` for the free instance — the server honors it
(`SERVER_PORT` → `PORT` → 3000, see `apps/server/src/core/config.ts`).

Note: Render's free instance sleeps after ~15 min idle; the first request after sleep
takes a few seconds. Acceptable for a demo/hobby deployment.

Your backend URL will look like `https://ghostlink-api.onrender.com`.

---

## 3) Frontend on Vercel (free)

1. https://vercel.com/new → import the GitHub repo
2. **Root Directory: `apps/web`** (important — monorepo)
3. Framework preset: **Next.js**
4. **Build Command:** `npm run build` (builds the shared package first)
5. Output directory: leave default (`.next`)
6. Environment variables:
   - `NEXT_PUBLIC_API_URL=https://ghostlink-api.onrender.com` (your Render URL)
   - `NEXT_PUBLIC_WS_URL=https://ghostlink-api.onrender.com` (same as API — socket.io
     connects on `/socket.io` of this origin; use `https`, not `wss://`)
7. Deploy. Vercel auto-detects the monorepo from the root `package-lock.json`.

Your app URL will look like `https://ghostlink-web.vercel.app`.

---

## 4) Wire CORS + final check

- Confirm `ALLOWED_ORIGINS` on Render contains your exact Vercel URL.
- Open `https://<your-vercel-app>.vercel.app/api/health` (or the Render URL + `/api/health`)
  → should return `{"status":"ok",...}`.
- Open the app, start a session, open the same site in a second browser/tab and random-match
  against yourself (same Render instance = same process, works even in free-tier single replica).

### Optional extras (still free)

- **Upstash Redis** (serverless, generous free tier): copy the internal URL into Render's
  `REDIS_URL`. Persistence is still disabled/unneeded.
- **Prometheus scraping**: set a ≥16-char `METRICS_TOKEN` on Render, scrape
  `GET /api/metrics` with a matching `metrics-token` header.

---

## Notes & limits of the free stack

- Single backend instance → realtime matching works; multi-replica Socket.IO fan-out would
  need the `socket.io-redis` adapter (not needed at hobby scale).
- Vercel Hobby bills nothing for this usage; no serverless functions are used (Next runs in
  Node server mode).
- If you outgrow the free tier: Render paid instance ($7/mo) or Fly.io both work with the
  same Dockerfiles without code changes.
