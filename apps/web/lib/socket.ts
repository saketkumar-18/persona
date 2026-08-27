'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ClientEvents,
  ServerEvents,
  MatchStartAck,
  PartnerInfo,
  RoomLeaveReason,
} from '@persona/shared';
import { WS_URL } from './env';

export type TypedSocket = Socket<ServerEvents, ClientEvents>;

export interface UseSocketOptions {
  token: string | null;
  enabled: boolean;
}

export interface SocketController {
  connected: boolean;
  queued: boolean;
  queuedPosition: number | null;
  room: string | null;
  partner: PartnerInfo | null;
  lastError: string | null;
  partnerTyping: boolean;
  notices: string[];
  /** Ref sink: set by the chat UI to receive ciphertext envelopes for the current room. */
  envelopeSink: { current: ((roomId: string, data: string) => void) | null };
  startMatching: (source: 'random' | 'nearby', zoneCell?: string) => Promise<MatchStartAck | null>;
  cancelMatching: () => void;
  setRoomInfo: (roomId: string, partner: PartnerInfo) => void;
  leaveRoom: () => void;
  sendChat: (roomId: string, data: string) => void;
  sendTyping: (roomId: string, isTyping: boolean) => void;
  sendPresence: (cellId: string, travel?: boolean) => void;
  clearPresence: () => void;
  disconnect: () => void;
}

/**
 * Realtime plane hook. Auto-joins rooms on `match:found` (both initiator ack
 * and partner-side push). The chat UI reads `room` + `partner`.
 */
export function useGhostSocket(opts: UseSocketOptions): SocketController {
  const { token, enabled } = opts;
  const socketRef = useRef<TypedSocket | null>(null);
  const roomRef = useRef<string | null>(null);

  const [connected, setConnected] = useState(false);
  const [queued, setQueued] = useState(false);
  const [queuedPosition, setQueuedPosition] = useState<number | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envelopeSink = useRef<((roomId: string, data: string) => void) | null>(null);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    if (!enabled || !token) return;

    const socket: TypedSocket = io(WS_URL || undefined, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      path: '/socket.io',
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('match:queued', ({ position }) => {
      setQueued(true);
      setQueuedPosition(position);
    });
    socket.on('match:found', ({ roomId, partner: p }) => {
      setQueued(false);
      setQueuedPosition(null);
      setRoom(roomId);
      setPartner(p);
    });
    socket.on('room:left', ({ roomId, reason }: { roomId: string; reason: RoomLeaveReason }) => {
      if (roomRef.current === roomId) {
        setRoom(null);
        setPartner(null);
      }
      setNotices((n) => [...n, `Chat ended (${reason}).`]);
    });
    socket.on('room:expired', ({ roomId }) => {
      if (roomRef.current === roomId) {
        setRoom(null);
        setPartner(null);
      }
      setNotices((n) => [...n, 'The room expired and was destroyed.']);
    });
    socket.on('chat:message', ({ roomId, data }) => {
      if (roomId !== roomRef.current) return;
      envelopeSink.current?.(roomId, data);
    });
    socket.on('chat:typing', ({ roomId, isTyping }) => {
      if (roomId !== roomRef.current) return;
      setPartnerTyping(isTyping);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setPartnerTyping(false), 3000);
    });
    socket.on('presence:update', () => {
      // Presence beacons are consumed by the discovery UI directly.
    });
    socket.on('error', ({ message, fatal }) => {
      setLastError(message);
      if (fatal) {
        socket.disconnect();
        setConnected(false);
      }
    });
    socket.on('moderation:notice', ({ message }) => setNotices((n) => [...n, message]));

    return () => {
      socket.disconnect();
      socketRef.current = null;
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token]);

  const startMatching = useCallback(
    (source: 'random' | 'nearby', zoneCell?: string) =>
      new Promise<MatchStartAck | null>((resolve) => {
        const socket = socketRef.current;
        if (!socket) return resolve(null);
        socket.emit('match:start', { source, zoneCell }, (ack) => {
          const a = ack as MatchStartAck;
          if (a.matched && a.roomId && a.partner) {
            setRoom(a.roomId);
            setPartner(a.partner);
            setQueued(false);
            setQueuedPosition(null);
          } else if (a.queued) {
            setQueued(true);
            setQueuedPosition(a.position ?? null);
          }
          if (a.error) setLastError(a.error);
          resolve(a);
        });
      }),
    [],
  );

  const cancelMatching = useCallback(() => {
    socketRef.current?.emit('match:cancel', {}, () => {
      setQueued(false);
      setQueuedPosition(null);
    });
  }, []);

  const setRoomInfo = useCallback((roomId: string, p: PartnerInfo) => {
    setRoom(roomId);
    setPartner(p);
    setQueued(false);
    setQueuedPosition(null);
  }, []);

  const leaveRoom = useCallback(() => {
    const r = roomRef.current;
    socketRef.current?.emit('room:leave', r ? { roomId: r } : {});
    setRoom(null);
    setPartner(null);
  }, []);

  const sendChat = useCallback((roomId: string, data: string) => {
    socketRef.current?.emit('chat:message', { roomId, data });
  }, []);

  const sendTyping = useCallback((roomId: string, isTyping: boolean) => {
    socketRef.current?.emit('chat:typing', { roomId, isTyping });
  }, []);

  const sendPresence = useCallback((cellId: string, travel?: boolean) => {
    socketRef.current?.emit('presence:tick', { cellId, travel });
  }, []);

  const clearPresence = useCallback(() => {
    socketRef.current?.emit('presence:clear', {});
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    setConnected(false);
  }, []);

  return {
    connected,
    queued,
    queuedPosition,
    room,
    partner,
    lastError,
    partnerTyping,
    notices,
    envelopeSink,
    startMatching,
    cancelMatching,
    setRoomInfo,
    leaveRoom,
    sendChat,
    sendTyping,
    sendPresence,
    clearPresence,
    disconnect,
  };
}
