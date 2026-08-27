'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PartnerInfo } from '@persona/shared';
import { useEncryptedChat } from '../lib/chat';
import { api } from '../lib/api';
import type { StoredGhostSession } from '../lib/storage';
import { pushToast } from './toast';

interface ChatRoomProps {
  session: StoredGhostSession;
  roomId: string;
  partner: PartnerInfo;
  typing: boolean;
  onLeave: () => void;
  sendEnvelope: (roomId: string, data: string) => void;
  sendTyping: (roomId: string, isTyping: boolean) => void;
  /** Ref owned by the socket hook; ChatRoom registers its decrypt pipeline here. */
  envelopeSink: { current: ((roomId: string, data: string) => void) | null };
}

/**
 * Ephemeral encrypted chat room.
 * - Messages are AES-GCM ciphertext on the wire; decrypted client-side.
 * - Nothing is persisted: closing the tab (or a refresh) erases everything.
 * - Safety code banner lets users compare public-key fingerprints.
 */
export default function ChatRoom({
  session,
  roomId,
  partner,
  typing,
  onLeave,
  sendEnvelope,
  sendTyping,
  envelopeSink,
}: ChatRoomProps) {
  const { messages, send, receive } = useEncryptedChat(session, roomId, partner, sendEnvelope);
  const [draft, setDraft] = useState('');
  const [agree, setAgree] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState('harassment');
  const [note, setNote] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const typingSent = useRef(false);

  useEffect(() => {
    envelopeSink.current = (rid: string, data: string) => {
      if (rid === roomId) void receive(data);
    };
    return () => {
      envelopeSink.current = null;
    };
  }, [envelopeSink, receive, roomId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const ok = await send(text);
    if (!ok) pushToast('Encryption not ready yet — retry in a second.');
    typingSent.current = false;
  }, [draft, send]);

  const onDraftChange = useCallback(
    (v: string) => {
      setDraft(v);
      if (!typingSent.current && v.length > 0) {
        typingSent.current = true;
        sendTyping(roomId, true);
        setTimeout(() => {
          typingSent.current = false;
        }, 2000);
      }
    },
    [sendTyping, roomId],
  );

  const block = useCallback(async () => {
    await api.block(session.token, partner.id, roomId, 'user-initiated').catch(() => undefined);
    pushToast('Partner blocked. This chat is over.');
    onLeave();
  }, [session.token, partner.id, roomId, onLeave]);

  const report = useCallback(async () => {
    const res = await api
      .report(session.token, partner.id, roomId, reportCategory, note || undefined)
      .catch(() => null);
    setReportOpen(false);
    setNote('');
    pushToast(res?.ok ? 'Report recorded. Thank you.' : 'Report failed to send.');
  }, [session.token, partner.id, roomId, reportCategory, note]);

  return (
    <div className="card flex h-[70vh] max-h-2xl flex-col overflow-hidden animate-fade-up">
      {/* header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] p-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{partner.emoji}</span>
          <div>
            <p className="font-semibold leading-tight">{partner.alias}</p>
            {partner.fingerprint && (
              <button
                type="button"
                className="text-left text-xs text-[var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--fg)]"
                onClick={() => setShowSafety((v) => !v)}
                aria-expanded={showSafety}
              >
                🔐 safety code: {partner.fingerprint} — what&apos;s this?
              </button>
            )}
          </div>
        </div>
        <span className="chip">🔒 end-to-end encrypted</span>
      </div>

      {/* safety-code explainer (toggled by the header button) */}
      {showSafety && partner.fingerprint && (
        <div className="space-y-1.5 border-b border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2.5 text-xs text-[var(--muted)]">
          <p>
            <strong className="text-[var(--fg)]">How to verify:</strong> contact this person through
            a channel you both trust (voice call, video, in person) and compare codes.
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>
              Your code: <code className="font-mono text-[var(--fg)]">{session.fingerprint}</code>
            </li>
            <li>
              Their code: <code className="font-mono text-[var(--fg)]">{partner.fingerprint}</code>
            </li>
          </ul>
          <p>
            Codes match → the encryption is genuine and nobody is intercepting. Mismatch → leave
            immediately and block.
          </p>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setShowSafety(false)}>
            Got it — hide
          </button>
        </div>
      )}

      {/* safety notice */}
      <div className="border-b border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--muted)]">
        🔒 Encrypted room · nothing is stored · messages vanish when the room closes. Never share
        personal details.
      </div>

      {/* messages */}
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            Say hi 👋 — this chat is encrypted and disappears forever when it ends.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
              m.mine
                ? 'ml-auto rounded-br-sm bg-[var(--accent)] text-white'
                : 'mr-auto rounded-bl-sm bg-[var(--accent-soft)]'
            }`}
          >
            {m.undecryptable ? (
              <em className="opacity-70">(could not decrypt)</em>
            ) : (
              m.text
            )}
          </div>
        ))}
        {typing && <p className="text-xs text-[var(--muted)]">typing…</p>}
      </div>

      {/* consent gate */}
      {!agree ? (
        <label className="flex items-center gap-2 border-t border-[var(--border)] p-3 text-xs">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          I understand this chat is anonymous, ephemeral, and that I should never share personal
          information.
        </label>
      ) : (
        <div className="flex items-center gap-2 border-t border-[var(--border)] p-3">
          <input
            className="input"
            value={draft}
            maxLength={3000}
            placeholder="Type an encrypted message…"
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            aria-label="Message"
          />
          <button type="button" className="btn-primary px-4 py-2.5" onClick={() => void submit()}>
            ➤
          </button>
        </div>
      )}

      {/* moderation */}
      <div className="flex gap-2 border-t border-[var(--border)] p-2">
        <button type="button" className="btn-ghost flex-1 text-xs" onClick={() => setReportOpen(true)}>
          🚩 Report
        </button>
        <button type="button" className="btn-danger flex-1 text-xs" onClick={() => void block()}>
          ⛔ Block & leave
        </button>
        <button type="button" className="btn-ghost flex-1 text-xs" onClick={onLeave}>
          👋 Leave
        </button>
      </div>

      {reportOpen && (
        <div className="space-y-2 border-t border-[var(--border)] p-3">
          <select
            className="input"
            value={reportCategory}
            onChange={(e) => setReportCategory(e.target.value)}
            aria-label="Report category"
          >
            <option value="harassment">Harassment</option>
            <option value="spam">Spam</option>
            <option value="inappropriate">Inappropriate content</option>
            <option value="impersonation">Impersonation</option>
            <option value="other">Other</option>
          </select>
          <textarea
            className="input"
            rows={2}
            maxLength={500}
            placeholder="Optional note (hash-only, never stored in clear text)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1 text-xs" onClick={() => void report()}>
              Submit report
            </button>
            <button type="button" className="btn-ghost flex-1 text-xs" onClick={() => setReportOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
