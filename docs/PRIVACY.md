# GhostLink Privacy & Threat Model

Privacy-by-design is a property of the architecture, not a settings page. This document states
exactly what data exists, where, for how long — and, equally important, what anonymity
**cannot** guarantee.

## Data inventory

### Never collected
- Real names, emails, phone numbers, passwords, payment info
- Device fingerprints, advertising IDs, analytics identifiers
- Chat content in readable form (rooms are E2E encrypted; server stores none)
- Permanent profiles or history of any kind

### Temporarily held (Redis only, TTL-bounded)

| Data | Purpose | Lifetime |
| --- | --- | --- |
| Session id, alias, emoji, status | Identity + routing | ≤ 24 h (default 4 h), destroyed immediately on close/burn |
| Session JWT (held by client, sessionStorage) | Auth | Tab lifetime |
| **Public** key + fingerprint | E2E key delivery | With the session |
| **Coarse** geohash cell (only when GPS discovery is on) | Nearby matching | Presence buckets expire with the session |
| Match queue entries (ids only) | Pairing | Seconds |
| QR pairing codes | Instant connect | 5 min, single-use |
| Block lists | Abuse safety | Expire with the session |
| Report counters + **hashed** notes | Moderation | Counters 24 h; notes stored only as SHA-256, 1 h |

### Private keys
Never leave the browser, never touch the server, never touch disk (sessionStorage only).
Closing the tab destroys them along with everything needed to rejoin a conversation.

## Location privacy
- Raw GPS is coarsened **on-device** into a geohash cell before any network request.
- Nearby distances/bearings are computed between **cell centers** — disclosure is bounded by
  cell size (~1 km standard, ~5 km reduced), never the user's actual point.
- Revoking permission, switching tabs, or burning the session stops all location use instantly.

## Threat model & honest limits
- **Anonymity is best-effort, not absolute.** The ISP/network admin still sees a connection to
  the service; browsers can be fingerprinted; partners see what you type.
- **Server-mediated key exchange.** A compromised server could substitute public keys during
  pairing. Mitigation: **safety codes** (public-key fingerprints) users can compare out-of-band.
- **No content moderation scanning** — we cannot read E2E messages by design. Abuse is handled
  through rate-limited, hashed reports and immediate blocking rather than surveillance.
- **Redis is ephemeral storage, not a security boundary.** Anyone with Redis access during a
  window could read session metadata — hence aggressive TTLs and zero PII fields.

## Consent
- GPS, camera, microphone, and Bluetooth all require explicit, revocable browser permission.
- No feature silently enables location or radio use.
- A visible pre-chat consent gate reminds users chats are anonymous, ephemeral, and that
  personal details should never be shared.

## Regulatory posture
Because we collect minimal, non-identifying, short-lived technical data and no personal data,
GhostLink carries a small GDPR/CCPA surface: no profiling, no marketing, no third-party
advertising, no data sales. What little session data exists has built-in expiry and is fully
deletable on demand (burn session).
