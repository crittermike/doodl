/**
 * The client's WebSocket transport.
 *
 * Responsibilities beyond "send and receive JSON":
 *
 * - Reconnect with exponential backoff and jitter. Fly machines are configured
 *   to stop when idle, so the very first connection of the day can take several
 *   seconds to cold start. That is reported as a distinct `waking` status so the
 *   UI can say so rather than looking broken.
 * - Reclaim the player's seat automatically after a drop, using the session
 *   token the server issued.
 * - Fan messages out to subscribers *without* going through React. The canvas
 *   subscribes here directly, so a remote stroke never triggers a render.
 */

import type { ClientMessage, ServerMessage } from '@doodl/shared';

export type ConnStatus =
  | 'idle'
  | 'connecting'
  /** Taking unusually long — probably a cold start. */
  | 'waking'
  | 'open'
  | 'reconnecting'
  | 'closed'
  /** Unrecoverable: room gone, kicked, name taken. Do not retry. */
  | 'fatal';

export interface JoinIntent {
  mode: 'create' | 'join';
  name: string;
  avatar: string;
  code?: string;
  session?: string;
}

type MessageListener = (msg: ServerMessage) => void;
type StatusListener = (status: ConnStatus, detail?: string) => void;

const BASE_DELAY_MS = 600;
const MAX_DELAY_MS = 15_000;
const BACKOFF_FACTOR = 1.7;
/** Past this, assume the server is cold starting rather than unreachable. */
const WAKING_AFTER_MS = 1_800;

function socketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export class DoodlSocket {
  private ws: WebSocket | null = null;
  private intent: JoinIntent | null = null;
  private status: ConnStatus = 'idle';

  private attempt = 0;
  private retryTimer: number | null = null;
  private wakingTimer: number | null = null;
  private closedByUs = false;

  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  /** Set from the server's `joined` reply; added to every deadline. */
  clockOffset = 0;

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  onMessage(fn: MessageListener): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  getStatus(): ConnStatus {
    return this.status;
  }

  private setStatus(status: ConnStatus, detail?: string): void {
    if (this.status === status && !detail) return;
    this.status = status;
    for (const fn of this.statusListeners) fn(status, detail);
  }

  private emit(msg: ServerMessage): void {
    for (const fn of this.messageListeners) fn(msg);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  connect(intent: JoinIntent): void {
    this.intent = intent;
    this.attempt = 0;
    this.closedByUs = false;
    this.open();
  }

  /** Remember the session token so a reconnect lands back in the same seat. */
  setSession(session: string, code: string): void {
    if (!this.intent) return;
    this.intent = { ...this.intent, mode: 'join', session, code };
  }

  private open(): void {
    if (!this.intent) return;
    this.clearTimers();
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    // A slow open almost always means the machine is booting, not that
    // anything is wrong. Say so instead of showing a dead-looking screen.
    this.wakingTimer = window.setTimeout(() => {
      if (this.status === 'connecting' || this.status === 'reconnecting') {
        this.setStatus('waking');
      }
    }, WAKING_AFTER_MS);

    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.wakingTimer) window.clearTimeout(this.wakingTimer);
      this.attempt = 0;
      const intent = this.intent;
      if (!intent) return;

      const handshake: ClientMessage =
        intent.mode === 'create'
          ? { t: 'create', name: intent.name, avatar: intent.avatar }
          : {
              t: 'join',
              name: intent.name,
              avatar: intent.avatar,
              code: intent.code ?? '',
              ...(intent.session ? { session: intent.session } : {}),
            };
      ws.send(JSON.stringify(handshake));
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      if (msg.t === 'joined') {
        this.clockOffset = msg.now - Date.now();
        this.setSession(msg.session, msg.room.code);
        this.setStatus('open');
      }

      // A fatal error means retrying would just fail the same way.
      if (msg.t === 'error' && msg.fatal) {
        this.closedByUs = true;
        this.setStatus('fatal', msg.message);
      }

      this.emit(msg);
    };

    ws.onerror = () => {
      // `onclose` always follows; retry scheduling happens there.
    };

    ws.onclose = () => {
      if (this.wakingTimer) window.clearTimeout(this.wakingTimer);
      this.ws = null;
      if (this.closedByUs) {
        if (this.status !== 'fatal') this.setStatus('closed');
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.closedByUs || !this.intent) return;

    const raw = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * BACKOFF_FACTOR ** this.attempt);
    // Jitter stops every client in a room from reconnecting in lockstep after
    // a server restart.
    const delay = Math.round(raw * (0.75 + Math.random() * 0.5));
    this.attempt += 1;

    this.setStatus('reconnecting');
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private clearTimers(): void {
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    if (this.wakingTimer) window.clearTimeout(this.wakingTimer);
    this.retryTimer = null;
    this.wakingTimer = null;
  }

  /** Force an immediate retry — used when the tab or network comes back. */
  retryNow(): void {
    if (this.closedByUs || !this.intent) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.attempt = 0;
    this.open();
  }

  send(msg: ClientMessage): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closedByUs = true;
    this.intent = null;
    this.clearTimers();
    this.ws?.close(1000, 'CLIENT_LEAVE');
    this.ws = null;
    this.setStatus('idle');
  }
}
