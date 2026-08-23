# GhostLink — $0 Production Deployment

This stack puts GhostLink online for free, no credit card, on two accounts you create via GitHub/GitHub OAuth:

| Piece | Provider | Why it's free |
| --- | --- | --- |
| Frontend (Next.js PWA) | **Vercel** | Hobby plan auto-attached to your GitHub |
| Backend (NestJS + Socket.IO, Docker) | **Render** | Free "Docker" web service tier |
| Key/value store (Redis) | Render free Redis *or* server memory fallback | No persistence needed — data is ephemeral |

The backend runs the `docker/Dockerfile.server` image on Render's free instance. Render injects `$PORT`;
`apps/server/src/core/config.ts` already reads `SERVER_PORT ?? PORT ?? 3000`.

> **Free-tier reality check**: Render free instances sleep after ~15 min idle. First request after sleep
> takes a few seconds. Fine for a demo/hobby app. Render will migrate old free plans after 90 days; see
> their announcement for details.

---

## 1) Backend + Redis on Render (one-click Blueprint)

The repo root has a `render.yaml` Blueprint that provisions **both services**:

1. Open this URL in a browser while logged into Render with GitHub:

   `https://render.com/new?snippet=https://github.com/<YOUR-GH-USER>/GhostLink/blob/master/render.yaml`

   (Replace `<YOUR-GH-USER>` with your GitHub username.)

2. Render reads the Blueprint and creates:
   - `ghostlink-api` — Docker web service, free plan, build from repo root
   - `ghostlink-redis` — free Redis, auto-wired into `REDIS_URL`
   - Random `SESSION_JWT_SECRET` / `PARTNER_CONTROL_SECRET`

3. **Wait for the first deploy** (Render logs show it building the image; ~5-10 min).

4. Once live, verify: open `https://<your-render-slug>.onrender.com/api/health`
   → `{"status":"ok","redis":"up",...}`.

5. **Set the CORS allowlist for your frontend** (do this AFTER step 2 below or on a placeholder):
   Render → `ghostlink-api` → **Environment** → add:

   ```
   ALLOWED_ORIGINS=https://<your-vercel-app>.vercel.app
   ```

   (Include any additional/production domains, comma-separated.)

---

## 2) Frontend on Vercel

1. Go to https://vercel.com/new and import the GitHub repo.
2. Settings:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `apps/web`
   - **Build Command**: leave default (`next build`)
   - **Output Directory**: leave default (`.next`)
   - **Install Command**: leave default (`npm install`) — Vercel respects the workspace lockfile
3. Environment variables (before first deploy):

   ```
   NEXT_PUBLIC_API_URL=https://<render-slug>.onrender.com
   NEXT_PUBLIC_WS_URL=https://<render-slug>.onrender.com
   ```

   (`socket.io-client` connects to `/socket.io` under that origin; keep http(s).)

4. Deploy. Vercel auto-detects Next.js and the monorepo from the root `package-lock.json`.
   Your app URL looks like `https://ghostlink-<you>.vercel.app`.

5. Update `ALLOWED_ORIGINS` on Render to this exact URL (Environment tab) and reconcile the service.

---

## 3) Verify production

```bash
curl -s https://<render-slug>.onrender.com/api/health          # status: ok
curl -s https://<vercel-app>.vercel.app/api/health             # CORS preflight should be green
```

- Ghost: open the site, tap "Start anonymous session," check the dashboard loads.
- Match: two browser tabs/devices → Match tab → should pair via the live Redis queue.

### Optional extras (still free)

- **Upstash Redis** — serverless Redis with a generous free tier; copy its `rediss://` URL into
  Render's `REDIS_URL` for a warmer cache.
- **Prometheus scrape**: set a ≥16-char `METRICS_TOKEN` on Render, then scrape
  `GET /api/metrics` with a `metrics-token` header.
- **Custom domain**: Vercel supports `vercel.app` custom domains free; add your domain in
  Vercel → Settings → Domains, then append it to Render's `ALLOWED_ORIGINS`.

### Limits of the free stack

- Single backend replica: realtime matching works; multi-replica Socket.IO fan-out needs
  `socket.io-redis` adapter (not needed at hobby scale).
- Redis maxmemoryPolicy `noeviction`: keys expire naturally; if Redis fills (unlikely for a demo),
  favorites just evict — no data loss since everything is ephemeral.
