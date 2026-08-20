/**
 * The doodl wire protocol.
 *
 * Every message is a JSON object with a discriminating `t` field. JSON is
 * deliberate: at a ceiling of 16 players per room the bandwidth difference
 * versus a packed binary encoding is irrelevant, and being able to read the
 * traffic in devtools is worth far more than the bytes.
 *
 * Coordinates on the wire are `Q12` — 12-bit integers in 0..4095 representing
 * a normalized 0..1 position on the canvas. See `strokes.ts`.
 */

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

/** A quantized point: [x, y] with each component an integer in 0..COORD_MAX. */
export type QPoint = [number, number];

/** A point in continuous space (canvas pixels or normalized 0..1). */
export type Point = [number, number];

export type Tool = 'brush' | 'eraser';

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'turnEnd' | 'gameEnd';

/** Which chat stream a message belongs to. */
export type ChatChannel =
  /** Everyone in the room sees it. */
  | 'all'
  /** Only players who already guessed correctly, plus the drawer. */
  | 'correct';

export type SystemKind = 'info' | 'join' | 'leave' | 'correct' | 'close' | 'warn';

export interface RoomSettings {
  rounds: number;
  drawTime: number;
  maxPlayers: number;
  /** Number of letters progressively revealed as the turn elapses. */
  hints: number;
  /** Optional per-room word list. */
  customWords: string[];
  /** When true, only `customWords` are used; otherwise they're added to the default list. */
  customWordsOnly: boolean;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  score: number;
  /** Points earned this turn; reset at the start of each turn. */
  turnScore: number;
  connected: boolean;
  isHost: boolean;
  /** True once this player has guessed the current word. Never reveals the word. */
  hasGuessed: boolean;
  /** True while this player is the drawer. */
  isDrawer: boolean;
}

/**
 * A retained drawing operation. The server keeps the ordered list for the
 * current turn so that late joiners and reconnecting players get a full replay
 * instead of a blank canvas.
 */
export type DrawOp =
  | {
      t: 'stroke';
      pts: QPoint[];
      color: string;
      width: number;
      tool: Tool;
      /** Groups the flushed segments of one continuous pointer gesture. */
      sid: number;
    }
  | { t: 'fill'; pt: QPoint; color: string };

export interface RoomState {
  code: string;
  hostId: string;
  phase: Phase;
  settings: RoomSettings;
  players: PublicPlayer[];
  /** 1-based; 0 while in the lobby. */
  round: number;
  drawerId: string | null;
  /** Epoch ms at which the current phase's timer expires, if any. */
  deadline: number | null;
  /** Masked word shown to guessers, e.g. "_ _ a _". Null outside a turn. */
  pattern: string | null;
  /** Length of the current word (including spaces/hyphens). */
  wordLength: number | null;
}

export interface ScoreDelta {
  playerId: string;
  delta: number;
  total: number;
  /** Order in which they guessed, 1-based. Null if they didn't guess. */
  place: number | null;
}

export interface Standing {
  playerId: string;
  name: string;
  avatar: string;
  score: number;
  rank: number;
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  /** Create a new room and join it as host. */
  | { t: 'create'; name: string; avatar: string }
  /** Join an existing room. `session` resumes a previously held seat. */
  | { t: 'join'; name: string; avatar: string; code: string; session?: string }
  /** Host-only: update room settings while in the lobby. */
  | { t: 'settings'; settings: Partial<RoomSettings> }
  /** Host-only: begin the game. */
  | { t: 'start' }
  /** Host-only: return a finished game to the lobby. */
  | { t: 'playAgain' }
  /** Host-only: remove a player. */
  | { t: 'kick'; playerId: string }
  /** Drawer-only: choose one of the offered words by index. */
  | { t: 'pick'; index: number }
  /** Drawer-only: append a stroke segment. */
  | { t: 'stroke'; pts: QPoint[]; color: string; width: number; tool: Tool; sid: number }
  /** Drawer-only: flood fill from a point. Clients run the fill themselves. */
  | { t: 'fill'; pt: QPoint; color: string }
  /** Drawer-only: undo the most recent gesture. */
  | { t: 'undo' }
  /** Drawer-only: wipe the canvas. */
  | { t: 'clear' }
  /** A chat message, which may also be a guess. */
  | { t: 'chat'; text: string };

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_IN_PROGRESS'
  | 'NAME_TAKEN'
  | 'NOT_HOST'
  | 'NOT_DRAWER'
  | 'NOT_IN_ROOM'
  | 'INVALID_SETTINGS'
  | 'NOT_ENOUGH_PLAYERS'
  | 'RATE_LIMITED'
  | 'KICKED'
  | 'SERVER_FULL';

export type ServerMessage =
  /** Sent once on a successful create/join. */
  | {
      t: 'joined';
      you: string;
      /** Opaque token; present it as `join.session` to reclaim this seat. */
      session: string;
      room: RoomState;
    }
  /** Full room snapshot. Sent on any structural change. */
  | { t: 'room'; room: RoomState }
  | { t: 'error'; code: ErrorCode; message: string; fatal?: boolean }
  /** A regular chat message. Correct guesses are NEVER delivered this way. */
  | { t: 'chat'; from: string; name: string; text: string; channel: ChatChannel }
  /** Server-authored notice (joins, leaves, "X guessed the word!", ...). */
  | { t: 'system'; text: string; kind: SystemKind }
  /** Word-selection phase. `choices` is only populated for the drawer. */
  | { t: 'choosing'; drawerId: string; deadline: number; choices?: string[] }
  /** A turn begins. `word` is only populated for the drawer. */
  | {
      t: 'turnStart';
      drawerId: string;
      round: number;
      deadline: number;
      wordLength: number;
      pattern: string;
      word?: string;
    }
  /** A hint letter was revealed. */
  | { t: 'hint'; pattern: string }
  /** Full replay of the current turn's canvas. */
  | { t: 'replay'; ops: DrawOp[] }
  /** Broadcast draw operations. Mirrors `DrawOp` plus the originating gesture. */
  | { t: 'stroke'; pts: QPoint[]; color: string; width: number; tool: Tool; sid: number }
  | { t: 'fill'; pt: QPoint; color: string }
  | { t: 'undo' }
  | { t: 'clear' }
  /** Someone guessed correctly. The word itself is not included. */
  | { t: 'guessed'; playerId: string; place: number }
  /** Private nudge sent only to the near-miss guesser. */
  | { t: 'close' }
  /** Turn over: the word is finally revealed to everyone. */
  | { t: 'turnEnd'; word: string; deltas: ScoreDelta[]; deadline: number }
  /** Game over. */
  | { t: 'gameEnd'; standings: Standing[]; deadline: number }
  /** Application-level keepalive (the socket also uses ws ping/pong frames). */
  | { t: 'ping' };
