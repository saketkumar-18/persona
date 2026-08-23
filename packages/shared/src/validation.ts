import { MAX_ALIAS_LENGTH, MAX_REPORT_NOTE_LENGTH } from './types';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Trim + clamp strings; reject control chars. */
export function sanitizeText(raw: unknown, maxLength: number, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().replace(/[\u0000-\u001f\u007f]/g, '').replace(/[[\]{}<>\\]/g, '');
  const sliced = trimmed.slice(0, maxLength);
  return sliced || fallback;
}

export function sanitizeAlias(raw: unknown, existing: string): string {
  return sanitizeText(raw, MAX_ALIAS_LENGTH, existing);
}

export function sanitizeReportNote(raw: unknown, existing: string): string {
  return sanitizeText(raw, MAX_REPORT_NOTE_LENGTH, existing);
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function asRecord(v: unknown): Record<string, Json> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Record<string, Json>;
}
