export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? API_URL;

export const API_BASE = `${API_URL}/api`;
