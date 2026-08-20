/**
 * doodl server: one process serving both the built client over HTTP and the
 * game over WebSocket.
 *
 * Single-origin by design — there is no CORS configuration anywhere because
 * there is no cross-origin request to make.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { HEARTBEAT_MS, MIN_PLAYERS_TO_START, type ClientMessage, type ErrorCode, type ServerMessage } from '@doodl/shared';
import { TokenBucket } from './rateLimit.js';
import type { Player, Room } from './room.js';
import { RoomRegistry } from './rooms.js';
import { StaticServer } from './static.js';
import { parseClientMessage } from './validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIR = process.env.CLIENT_DIR ?? resolve(__dirname, '../../client/dist');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DEBUG_WIRE = process.env.DEBUG_WIRE === '1';

/** Largest frame we will even look at. Well above a full 512-point stroke. */
const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Sockets that connect and never complete a handshake are dropped. */
const HANDSHAKE_TIMEOUT_MS = 20_000;

const registry = new RoomRegistry();
const staticServer = new StaticServer(CLIENT_DIR);

interface ConnState {
  room: Room | null;
  player: Player | null;
  alive: boolean;
  /** Bounds create/join spam from a socket that hasn't joined anything yet. */
  handshake: TokenBucket;
  handshakeTimer: NodeJS.Timeout | null;
}

const conns = new Map<WebSocket, ConnState>();

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function reject(socket: WebSocket, code: ErrorCode, message: string): void {
  send(socket, { t: 'error', code, message, fatal: true });
  socket.close(4000, code);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const path = (req.url ?? '/').split('?')[0];

  if (path === '/healthz') {
    const body = JSON.stringify({
      ok: true,
      uptime: Math.round(process.uptime()),
      rooms: registry.size,
      players: registry.playerCount,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  void staticServer.handle(req, res).catch((err) => {
    console.error('[http] static handler failed', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  });
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

httpServer.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/ws') {
    socket.destroy();
    return;
  }

  // Same-origin deployment means this is normally unset and unnecessary, but an
  // operator fronting the app differently can lock it down.
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (socket: WebSocket) => {
  const handshakeTimer = setTimeout(() => {
    if (!state.player) socket.close(4008, 'HANDSHAKE_TIMEOUT');
  }, HANDSHAKE_TIMEOUT_MS);
  handshakeTimer.unref?.();

  const state: ConnState = {
    room: null,
    player: null,
    alive: true,
    handshake: new TokenBucket({ capacity: 5, refillPerSec: 0.5 }),
    handshakeTimer,
  };
  conns.set(socket, state);

  socket.on('pong', () => {
    state.alive = true;
  });

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const raw = data.toString();
    if (DEBUG_WIRE) console.log('<-', raw.slice(0, 300));

    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      send(socket, { t: 'error', code: 'BAD_MESSAGE', message: parsed.reason });
      return;
    }
    const msg = parsed.value;

    if (msg.t === 'create' || msg.t === 'join') {
      if (state.player) return; // already seated; ignore
      if (!state.handshake.take()) {
        reject(socket, 'RATE_LIMITED', 'Too many attempts. Wait a moment and try again.');
        return;
      }
      handleHandshake(socket, state, msg);
      return;
    }

    if (!state.room || !state.player) {
      send(socket, { t: 'error', code: 'NOT_IN_ROOM', message: 'Join a room first.' });
      return;
    }

    try {
      state.room.handleMessage(state.player, msg);
    } catch (err) {
      console.error('[ws] message handler failed', err);
      send(socket, { t: 'error', code: 'BAD_MESSAGE', message: 'Something went wrong handling that.' });
    }
  });

  socket.on('close', () => {
    if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
    conns.delete(socket);
    if (state.room && state.player) {
      try {
        state.room.handleDisconnect(state.player);
      } catch (err) {
        console.error('[ws] disconnect handler failed', err);
      }
    }
  });

  socket.on('error', () => socket.terminate());
});

function handleHandshake(
  socket: WebSocket,
  state: ConnState,
  msg: Extract<ClientMessage, { t: 'create' | 'join' }>,
): void {
  let room: Room | undefined;

  if (msg.t === 'create') {
    const created = registry.create();
    if (!created) {
      reject(socket, 'SERVER_FULL', 'This server is at capacity. Try again shortly.');
      return;
    }
    room = created;
  } else {
    room = registry.get(msg.code);
    if (!room) {
      reject(socket, 'ROOM_NOT_FOUND', `No room with the code ${msg.code}.`);
      return;
    }
  }

  // Reconnecting into a seat we already hold takes priority over every check
  // below — the seat is already allocated, so capacity and names don't apply.
  if (msg.t === 'join' && msg.session) {
    const existing = room.findBySession(msg.session);
    if (existing) {
      state.room = room;
      state.player = room.reattach(existing, socket, msg.name, msg.avatar);
      if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
      return;
    }
  }

  if (room.isFull) {
    reject(socket, 'ROOM_FULL', 'That room is full.');
    return;
  }
  if (room.hasName(msg.name)) {
    reject(socket, 'NAME_TAKEN', 'Someone in that room is already using that name.');
    return;
  }

  state.room = room;
  state.player = room.addPlayer(socket, msg.name, msg.avatar);
  if (state.handshakeTimer) clearTimeout(state.handshakeTimer);
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/**
 * A TCP connection can die without either side noticing — laptop lid closed,
 * mobile handoff, NAT timeout. Without this, those sockets sit in the room
 * forever holding a seat. Browsers answer ping frames automatically, so this
 * needs no client cooperation.
 */
const heartbeat = setInterval(() => {
  for (const [socket, state] of conns) {
    if (!state.alive) {
      socket.terminate();
      continue;
    }
    state.alive = false;
    try {
      socket.ping();
    } catch {
      socket.terminate();
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

registry.start();

httpServer.listen(PORT, () => {
  console.log(`doodl listening on :${PORT}`);
  console.log(`  client dir : ${CLIENT_DIR}`);
  console.log(`  ws path    : /ws`);
  console.log(`  min players: ${MIN_PLAYERS_TO_START}`);
});

function shutdown(signal: string): void {
  console.log(`\n[${signal}] shutting down`);
  clearInterval(heartbeat);
  registry.stop();
  for (const socket of conns.keys()) socket.close(1001, 'SERVER_SHUTDOWN');
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => console.error('[fatal] uncaught exception', err));
process.on('unhandledRejection', (err) => console.error('[fatal] unhandled rejection', err));
