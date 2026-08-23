# GhostLink API Reference

Base URL: `http://localhost:3000/api` (dev). Interactive Swagger UI: `http://localhost:3000/docs`.

All authenticated routes use `Authorization: Bearer <sessionToken>` where `sessionToken` is
the JWT returned by `POST /sessions`.

Errors return `{ "error": { "code": "<CODE>", "message": "…", "hint?": "…" } }`.

| Code | Meaning |
| --- | --- |
| `INVALID_TOKEN` / `UNAUTHORIZED` | Missing/invalid/expired session JWT |
| `SESSION_NOT_FOUND` / `SESSION_EXPIRED` | Session gone (burned or TTL elapsed) |
| `ROOM_NOT_FOUND` / `NOT_IN_ROOM` | Room missing or caller not a member |
| `MALFORMED` / `PAYLOAD_TOO_LARGE` | Bad request body |
| `RATE_LIMITED` | Throttled |
| `INTERNAL` | Unexpected server error |

---

## Sessions

### POST /sessions
Create an anonymous session. **Public** — no auth.
```json
// request (all optional)
{ "alias": "Lone Fox", "emoji": "🦊", "ttlSeconds": 14400,
  "publicKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" },
  "fingerprint": "AB12-CD34" }
```
```json
// response 201
{ "sessionId": "gl_…", "token": "eyJhbGciOi…", "session": { … } }
```
Invalid body → `400 MALFORMED`.

### GET /sessions/me — current profile (`404 SESSION_NOT_FOUND` if gone)
### PATCH /sessions/me — update `alias` / `emoji` / `publicKey` / `fingerprint`
### DELETE /sessions/me — burn immediately (kicks live sockets, invalidates token)

---

## Discovery

### POST /discovery/nearby
GPS discovery. Coarse geohash cell only — never raw coords.
```json
{ "cellId": "u33dc0", "travelOnly": false, "limit": 50 }
```
Returns sessions in the cell + 8 neighbors with center-to-center `distanceMeters`,
`bearingDeg`, and `travel` flag.

### POST /discovery/zone
Enter a Ghost Zone (Event/Travel mode) by coarse cell.
```json
{ "cellId": "u33dc", "ttlSeconds": 1800 }
```
Returns `{ zone, activeSessions }`.

### GET /discovery/zones
Active zone for my current cell: `{ zones: [], totalMembers }`.

---

## QR / Instant connect

### POST /qr/create
Generate a single-use pairing code. Rate-limited per session.
```json
{ "code": "ql_abc123", "expiresAt": 1735000000000 }
```

### POST /qr/redeem
Redeem a scanned code → instant room.
```json
{ "code": "ql_abc123" }
```
```json
{ "ok": true, "roomId": "rm_…", "partner": { "id", "alias", "emoji", "publicKey", "fingerprint" } }
```
Second redemption → `{ "ok": false }`.

### POST /qr/connect
Connect directly with a discovered session (nearby "Connect" button).
```json
{ "sessionId": "gl_…" }
```
Returns a room + partner with public key for E2E. Fails if either side is already in chat.

---

## Moderation

### POST /moderation/block
```json
{ "sessionId": "gl_…", "roomId": "rm_…", "reason": "…" }
```
Tears down the shared room, notifies the partner `room:left`, records the block. Returns
`{ "ok": true, "mutual": bool }`.

### POST /moderation/report
```json
{ "sessionId": "gl_…", "roomId": "rm_…", "category": "harassment", "note": "…" }
```
`category` ∈ harassment/spam/inappropriate/impersonation/other. Notes are stored only as a
hash. Returns `{ "ok": true, "escalated": bool }` once the per-session report cap is hit.

---

## System

### GET /health — liveness + Redis status + version
### GET /status — public aggregates (`activeSessions`, `activeRooms`, `uptimeSeconds`)
### GET /metrics — Prometheus text; if `METRICS_TOKEN` is set, requires a matching
`metrics-token` header.

---

## WebSocket events (Socket.IO `/{ default namespace }`)

Connect with `io(WS_URL, { auth: { token } })`. Invalid/expired token → server emits
`error` and disconnects.

Client → server: `match:start`, `match:cancel`, `room:join`, `room:leave`,
`chat:message`, `chat:typing`, `presence:tick`, `presence:clear`.

Server → client: `match:queued`, `match:found`, `room:left`, `room:expired`,
`chat:message`, `chat:typing`, `presence:update`, `error`, `moderation:notice`.

`chat:message` payload `{ roomId, data, receivedAt }` where `data` is an AES-GCM envelope.
