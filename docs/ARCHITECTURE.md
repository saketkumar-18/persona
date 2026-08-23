# GhostLink Architecture

## Design principles

1. **Ephemeral by default** — every piece of state lives in Redis with a TTL. There is no
   persistent write path. When Redis (or the in-memory fallback) expires a key, the data is gone.
2. **No identity, no account** — the session token *is* the account. Possession of the JWT is
   the only credential. There is nothing to recover, reset, or breach.
3. **Coarsen before transmit** — location is reduced to a geohash cell on-device. The server
   never receives raw GPS.
4. **Split planes** — control operations (session CRUD, discovery, QR, moderation) are REST so
   they can be rate-limited, cached, and tested; the realtime chat plane is Socket.IO.
5. **Server never holds keys** — E2E room keys are derived client-side from ephemeral ECDH. The
   server relays ciphertext only.

## System diagram

```
                 ┌─────────────────────────────┐
                 │  Browser (Next.js PWA)      │
                 │  - session in sessionStorage │
                 │  - ephemeral ECDH privkey    │
                 │  - geohash coarsening        │
                 └───────┬──────────────┬──────┘
        REST control plane    │              │  Socket.IO realtime plane
        (Bearer JWT)          │              │  (token in handshake)
                              ▼              ▼
        ┌───────────────────────────────────────────────┐
        │              NestJS Server                     │
        │  ┌─────────────┐      ┌────────────────────┐  │
        │  │ Controllers  │      │  RealtimeGateway   │  │
        │  │ sessions     │      │  (Socket.IO)       │  │
        │  │ discovery    │◄────►│  match / relay /   │  │
        │  │ qr, moderat. │ reg  │  room lifecycle    │  │
        │  └──────┬───────┘      └─────────┬──────────┘  │
        │         └──────────┬─────────────┘             │
        │                    ▼                            │
        │        ┌────────────────────────┐               │
        │        │  RedisService           │  (in-memory   │
        │        │  TTL datastore          │   fallback)   │
        │        └────────────────────────┘               │
        └───────────────────────────────────────────────┘
```

The `GatewayRegistry` is a tiny indirection so REST controllers can notify realtime sockets
(e.g. push `match:found` to a QR-paired session) without a circular import.

## Request flows

### Create session
`POST /api/sessions` → generate id, random alias/emoji, store with TTL, sign JWT.
The browser generates its ECDH key pair and sends only the **public** key + fingerprint.

### Random matching
Socket `match:start` → `MatchingService.findPartner`:
1. Try to pop a compatible id from the global (or zone) FIFO queue, skipping blocklisted
   and in-chat entries.
2. If found → create room, set both `in_chat`, emit `match:found` to the queued side, ack
   the initiator.
3. Else → enqueue, ack with queue position.

### GPS discovery
Browser coarsens GPS → geohash cell → `POST /api/discovery/nearby {cellId}`. Server adds the
session to that cell's presence bucket and returns sessions in the cell ± neighbors with
center-to-center distance/bearing. **No raw coordinates cross the wire.**

### QR instant connect
Host: `POST /api/qr/create` → short single-use code (TTL 5 min). Scanner redeems via
`POST /api/qr/redeem {code}` (deep link `/join?code=…`). Server pairs both, deletes the code,
pushes `match:found` to the host over its socket.

### Direct connect (nearby "Connect")
`POST /api/qr/connect {sessionId}` → pairs two discovered sessions into a room, same semantics
as QR redeem.

## Redis key schema (all TTL-bounded)

| Key | Type | Meaning |
| --- | --- | --- |
| `sess:{id}` | string(JSON) | session record (profile, status, presence cell, pubkey) |
| `sessions:active` | set | active session ids (swept on read) |
| `room:{id}` | string(JSON) | two-member room |
| `sessroom:{sid}` | string | session → current room reverse index |
| `rooms:active` | set | active room ids |
| `match:queue:global` | list | FIFO match queue (ids only) |
| `match:queue:zone:{cell}` | list | per-zone FIFO queue |
| `presence:cell:{cell}` | set | sessions presenting a geohash cell |
| `qr:{code}` | string | pairing code → owner session |
| `qr:count:{sid}` | counter | per-session QR creation rate limit |
| `blocked:{sid}` | set | sessions this session blocked |
| `reports:{sid}` | counter | abuse-report count (escalation cap) |
| `reportnote:{sid}:{hash}` | string | SHA-256 of a report note (no clear text) |
| `flag:{sid}` | string(JSON) | escalated reporter flag (review) |

## Realtime protocol (Socket.IO, default namespace)

Handshake auth: `{ token: <JWT> }`. Verified before any event is processed.

**Client → Server**
`match:start`, `match:cancel`, `room:join`, `room:leave`, `chat:message` (ciphertext
envelope), `chat:typing`, `presence:tick`, `presence:clear`

**Server → Client**
`match:queued`, `match:found`, `room:left`, `room:expired`, `chat:message`, `chat:typing`,
`presence:update`, `error`, `moderation:notice`

## E2E encryption model

1. Each session generates an ephemeral **ECDH P-256** key pair in the browser.
2. Private key stays in `sessionStorage` (tab-scoped). Public key + fingerprint are uploaded.
3. On pairing, each side does `ECDH(myPriv, theirPub)`, then `HKDF-SHA256` keyed by the
   `roomId` into an **AES-256-GCM** room key.
4. Messages are `{v, iv, ct}` envelopes; the server relays `ct` verbatim and cannot decrypt.
5. **Safety codes** = short SHA-256 fingerprints of the public key, shown in the chat header,
   so users can compare out-of-band.

**Trust boundary**: pairing is server-mediated, so a compromised server *could* substitute
keys (classic MITM on key exchange). Safety codes are the mitigation. This is documented
honestly rather than oversold as "unbreakable".

## Rate limiting & abuse prevention
- `@nestjs/throttler` global guard (120/min, burst 30/10s) on REST.
- Per-session QR creation cap, per-session report counter, chat payload size cap.
- Blocks are mutual-optional and respected by the match queue.

## Observability
- `GET /api/health` (liveness), `GET /api/status` (aggregates), `GET /api/metrics`
  (Prometheus, optionally token-gated via `METRICS_TOKEN`).
- Metrics: sessions created, matches by source, messages relayed, report counts, queue depth.
