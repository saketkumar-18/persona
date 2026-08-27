'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NearUser, PartnerInfo } from '@ghostlink/shared';
import { useSessionManager } from '../lib/session';
import { useGhostSocket } from '../lib/socket';
import { api } from '../lib/api';
import GhostLobby from './ghost-lobby';
import MatchPanel from './match-panel';
import ChatRoom from './chat-room';
import DiscoverNearby from './discover-nearby';
import QrHost from './qr-host';
import QrScanner from './qr-scanner';
import InviteHost from './invite-host';
import GhostZones from './ghost-zones';
import { pushToast } from './toast';

type Tab = 'match' | 'nearby' | 'qr' | 'scan' | 'invite' | 'zone';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'match', label: '🎲 Match' },
  { id: 'nearby', label: '📍 Nearby' },
  { id: 'qr', label: '🟩 My QR' },
  { id: 'scan', label: '📷 Scan' },
  { id: 'invite', label: '🔗 Invite' },
  { id: 'zone', label: '🌫️ Zone' },
];

/**
 * GhostLink main experience. One session per tab; everything is ephemeral.
 * Tabs: matching (global/zone), nearby GPS discovery, QR host, QR scan,
 * ghost zones (event/travel).
 */
export default function GhostDashboard() {
  const { state, session, destroy, updateProfile } = useSessionManager();
  const socket = useGhostSocket({ token: session?.token ?? null, enabled: session !== null });
  const [tab, setTab] = useState<Tab>('match');
  const [zoneCell, setZoneCell] = useState<string | null>(null);
  const [zoneLabel, setZoneLabel] = useState<string | null>(null);
  const connectedNearby = useRef(false);

  const onPaired = useCallback(
    (roomId: string, partner: PartnerInfo) => {
      socket.setRoomInfo(roomId, partner);
      pushToast(`Matched with ${partner.alias} ${partner.emoji}`);
    },
    [socket],
  );

  // Restore room after a QR deep-link join (/join → /ghost with saved result).
  useEffect(() => {
    const raw = sessionStorage.getItem('ghostlink:joined-room');
    if (!raw) return;
    try {
      const { roomId, partner } = JSON.parse(raw) as {
        roomId: string;
        partner: PartnerInfo;
      };
      if (roomId && partner?.id) onPaired(roomId, partner);
    } finally {
      sessionStorage.removeItem('ghostlink:joined-room');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectToNearby = useCallback(
    async (user: NearUser) => {
      if (!session || connectedNearby.current) return;
      connectedNearby.current = true;
      try {
        const res = await api.connectDirect(session.token, user.session.id);
        if (res.ok && res.roomId && res.partner) {
          onPaired(res.roomId, res.partner);
        } else {
          pushToast('They are unavailable (already in a chat or expired).');
        }
      } finally {
        connectedNearby.current = false;
      }
    },
    [session, onPaired],
  );

  if (state !== 'active' || !session) {
    return <GhostLobby />;
  }

  // Active chat takes over the whole screen.
  if (socket.room && socket.partner) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-2 flex items-center justify-between text-sm">
          <p className="text-[var(--muted)]">
            You are <strong className="text-[var(--fg)]">{session.alias}</strong> {session.emoji}
          </p>
          <button type="button" className="text-xs text-[var(--muted)] underline" onClick={() => void destroy()}>
            destroy session
          </button>
        </div>
        <ChatRoom
          session={session}
          roomId={socket.room}
          partner={socket.partner}
          typing={socket.partnerTyping}
          onLeave={() => socket.leaveRoom()}
          sendEnvelope={(rid, data) => socket.sendChat(rid, data)}
          sendTyping={(rid, isTyping) => socket.sendTyping(rid, isTyping)}
          envelopeSink={socket.envelopeSink}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-3xl animate-floaty" aria-hidden>
            {session.emoji}
          </span>
          <div>
            <p className="font-bold leading-tight">{session.alias}</p>
            <p className="text-xs text-[var(--muted)]">
              expires{' '}
              {new Date(session.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · safety
              code {session.fingerprint}
            </p>
          </div>
        </div>
        <button type="button" className="btn-danger text-xs" onClick={() => void destroy()}>
          Burn session
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Discovery modes">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'bg-[var(--accent)] text-white'
                : 'border border-[var(--border)] hover:bg-[var(--accent-soft)]'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'match' && (
        <>
          {zoneCell && zoneLabel && (
            <button
              type="button"
              className="chip w-full justify-center py-2"
              onClick={() => {
                setZoneCell(null);
                setZoneLabel(null);
              }}
            >
              Zone: {zoneLabel} — tap to clear ✕
            </button>
          )}
          <MatchPanel
            queued={socket.queued}
            queuedPosition={socket.queuedPosition}
            connected={socket.connected}
            zoneCell={zoneCell}
            onStartRandom={() => void socket.startMatching('random', zoneCell ?? undefined)}
            onStartNearby={() => void socket.startMatching('nearby')}
            onCancel={() => socket.cancelMatching()}
          />
        </>
      )}

      {tab === 'nearby' && session && (
        <DiscoverNearby session={session} onConnect={(u) => void connectToNearby(u)} />
      )}

      {tab === 'qr' && session && <QrHost session={session} onPaired={onPaired} />}

      {tab === 'scan' && session && <QrScanner session={session} onPaired={onPaired} />}

      {tab === 'invite' && session && <InviteHost session={session} onPaired={onPaired} />}

      {tab === 'zone' && session && (
        <GhostZones
          session={session}
          onEnterZone={(cell, label) => {
            setZoneCell(cell);
            setZoneLabel(label);
          }}
        />
      )}

      <details className="card p-4 text-sm">
        <summary className="cursor-pointer font-medium">⚙️ Session options</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-xs text-[var(--muted)]" htmlFor="profile-alias">
              Change alias
            </label>
            <input
              id="profile-alias"
              className="input mt-1"
              maxLength={32}
              placeholder={session.alias}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (v) await updateProfile({ alias: v });
                }
              }}
            />
          </div>
          <p className="text-xs text-[var(--muted)]">
            Closing this tab destroys your session and every key involved. Nothing here is ever
            written to disk besides the ephemeral sessionStorage.
          </p>
        </div>
      </details>
    </div>
  );
}
