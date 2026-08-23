// Empty default = same-origin (works under any reverse-proxied domain).
// Set NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL only for split-domain deployments.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? '';

export const API_BASE = `${API_URL}/api`;
