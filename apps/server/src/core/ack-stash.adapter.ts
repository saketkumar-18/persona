import { INestApplicationContext } from '@nestjs/common';
import {
  AbstractWsAdapter,
  MessageMappingProperties,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import type { Observable } from 'rxjs';

/**
 * Why this exists
 * ---------------
 * Nest 10 populates ONLY decorated handler params (@ConnectedSocket,
 * @MessageBody). A plain `ack?: Ack` trailing parameter is always undefined,
 * so every handler guarding on `if (!ack) return` silently dropped events —
 * match:start / chat:message were never answered and clients hung forever.
 *
 * Nest 11 adds @Ack(), but a major upgrade mid-fix is risky. Instead this
 * adapter wraps each message handler and stashes the raw Socket.IO ack
 * callback on the socket before the gateway method runs. Handlers retrieve it
 * synchronously via `takeAck(socket)` — safe because Node executes the
 * synchronous prologue of one event callback before any other event runs.
 */

const ACK_KEY = '__gl_ack';

type AckFn = (response: unknown) => void;

interface AckStashSocket extends Socket {
  [ACK_KEY]?: AckFn | null;
}

interface WsMessageHandlerLike {
  message: string;
  callback: (data: unknown) => unknown;
}

export class AckStashAdapter extends AbstractWsAdapter {
  constructor(appOrHttpServer?: INestApplicationContext | unknown) {
    super(appOrHttpServer as INestApplicationContext);
  }

  /** Delegate server creation to the stock socket.io behavior. */
  create(port: number, options?: Record<string, unknown>): unknown {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Server } = require('socket.io');
    if (!options) return new Server(port);
    const { namespace, server, ...opt } = options as {
      namespace?: string;
      server?: { of?: (n: string) => unknown };
      [k: string]: unknown;
    };
    if (server && typeof server.of === 'function') return server.of(namespace ?? '/');
    if (this.httpServer && port === 0) return new Server(this.httpServer, opt);
    const srv = new Server(port, opt);
    return namespace ? srv.of(namespace) : srv;
  }

  /**
   * Standard Socket.IO dispatch loop (mirrors IoAdapter in
   * @nestjs/platform-socket.io): for every registered message handler, listen
   * on the socket event, split payload/ack, stash the ack, then run the Nest
   * pipeline. Returning a non-nil value would double-ack, so we filter it.
   */
  bindMessageHandlers(
    client: Socket,
    handlers: MessageMappingProperties[],
    transform: (data: unknown) => Observable<unknown>,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { fromEvent, mergeMap, takeUntil } = require('rxjs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isNil } = require('@nestjs/common/utils/shared.utils');

    const disconnect$ = fromEvent(client, 'disconnect');
    for (const { message, callback } of handlers as WsMessageHandlerLike[]) {
      fromEvent(client, message)
        .pipe(
          mergeMap(async (payload: unknown) => {
            const [body, ack] = splitPayload(payload);
            stashAck(client as AckStashSocket, ack);
            return transform(callback(body));
          }),
          takeUntil(disconnect$),
        )
        .subscribe();
    }
    void isNil;
  }
}

/** Mirrors @nestjs/platform-socket.io IoAdapter.mapPayload. */
function splitPayload(payload: unknown): [unknown, unknown] {
  if (!Array.isArray(payload)) {
    if (typeof payload === 'function') return [undefined, payload];
    return [payload, undefined];
  }
  const last = payload[payload.length - 1];
  if (typeof last === 'function') {
    const data = payload.length === 2 ? payload[0] : payload.slice(0, -1);
    return [data, last];
  }
  return [payload.length === 1 ? payload[0] : payload, undefined];
}

function stashAck(socket: AckStashSocket, ack: unknown): void {
  socket[ACK_KEY] = typeof ack === 'function' ? (ack as AckFn) : null;
}

/** Retrieve (and clear) the current event's ack callback inside a handler. */
export function takeAck(socket: Socket): AckFn | null {
  const s = socket as AckStashSocket;
  const ack = s[ACK_KEY] ?? null;
  s[ACK_KEY] = null;
  return typeof ack === 'function' ? ack : null;
}
