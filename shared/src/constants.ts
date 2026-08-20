/**
 * Constants shared by the client and the server.
 *
 * Anything that both sides must agree on lives here so the two can never
 * drift apart (canvas geometry, quantization width, timing, limits).
 */

/**
 * The canvas has a *fixed* backing-store resolution on every client. Doing it
 * this way (rather than sizing the backing store to the viewport) means all
 * clients rasterize identical pixel geometry, which keeps locally-executed
 * flood fills from diverging. The element is CSS-scaled to fit its container.
 */
export const CANVAS_W = 1200;
export const CANVAS_H = 800;
export const CANVAS_ASPECT = CANVAS_W / CANVAS_H;

/**
 * Wire coordinates are 12-bit integers spanning the normalized 0..1 range.
 * 4096 steps across a 1200px canvas is ~0.3px of quantization error, which is
 * invisible, and it roughly halves the payload compared to sending floats.
 */
export const COORD_BITS = 12;
export const COORD_MAX = (1 << COORD_BITS) - 1; // 4095

/** How often the client flushes its point buffer to the socket. */
export const STROKE_FLUSH_MS = 50;

/**
 * Minimum distance (in canvas pixels) between two kept points. Anything closer
 * is dropped before the stroke is sent.
 */
export const POINT_MIN_DIST_PX = 2;

/**
 * Ramer-Douglas-Peucker tolerance in canvas pixels, applied to a flushed
 * segment before it goes on the wire.
 */
export const RDP_EPSILON_PX = 0.75;

/** Flood fill colour-distance tolerance, 0-255 per channel (sum of squares). */
export const FILL_TOLERANCE = 40;

// --- Game rules -------------------------------------------------------------

export const DEFAULT_ROUNDS = 3;
export const DEFAULT_DRAW_TIME = 80;
export const DEFAULT_MAX_PLAYERS = 12;
export const DEFAULT_HINTS = 2;

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 10;
export const MIN_DRAW_TIME = 30;
export const MAX_DRAW_TIME = 180;
export const MIN_PLAYERS_TO_START = 2;
export const MIN_MAX_PLAYERS = 2;
export const MAX_MAX_PLAYERS = 16;
export const MAX_HINTS = 5;

/** Seconds the drawer has to pick one of the three offered words. */
export const WORD_PICK_SECONDS = 15;
/** Number of words offered to the drawer. */
export const WORD_CHOICES = 3;
/** How long the "here's the word, here are the scores" interstitial lasts. */
export const TURN_END_SECONDS = 6;
/** How long the final podium is shown before the room returns to the lobby. */
export const GAME_END_SECONDS = 20;

/**
 * A disconnected player keeps their seat (and score) for this long so a flaky
 * connection or a page refresh doesn't cost them the game.
 */
export const RECONNECT_GRACE_MS = 60_000;

// --- Limits (enforced server-side; clients are assumed hostile) -------------

export const MAX_NAME_LEN = 20;
export const MAX_CHAT_LEN = 160;
export const MAX_ROOM_CODE_LEN = 8;
export const MAX_WORD_LEN = 40;
export const MAX_CUSTOM_WORDS = 500;
export const MIN_CUSTOM_WORDS = 5;
export const MAX_POINTS_PER_MSG = 512;
export const MAX_OPS_PER_TURN = 6000;
export const MIN_BRUSH_WIDTH = 1;
export const MAX_BRUSH_WIDTH = 64;

/** Server ping interval; a socket that misses two in a row is terminated. */
export const HEARTBEAT_MS = 20_000;

// --- Rate limits ------------------------------------------------------------

export const CHAT_RATE = { capacity: 6, refillPerSec: 1.5 } as const;
export const DRAW_RATE = { capacity: 80, refillPerSec: 40 } as const;
export const ACTION_RATE = { capacity: 20, refillPerSec: 5 } as const;

// --- Scoring ----------------------------------------------------------------

/** Points a guesser gets with no time left on the clock. */
export const GUESS_POINTS_MIN = 50;
/** Points a guesser gets for an instant correct guess. */
export const GUESS_POINTS_MAX = 300;
/** Points the drawer gets when every eligible guesser got it. */
export const DRAWER_POINTS_MAX = 250;

// --- Presentation -----------------------------------------------------------

export const AVATARS = [
  '🐙', '🦊', '🐸', '🐼', '🦁', '🐧', '🦄', '🐝',
  '🦖', '🐢', '🦉', '🐰', '🐳', '🦩', '🐌', '🦔',
] as const;

export const PALETTE = [
  '#000000', '#666666', '#a0a0a0', '#ffffff',
  '#7f1d1d', '#dc2626', '#f97316', '#facc15',
  '#166534', '#22c55e', '#0e7490', '#22d3ee',
  '#1e3a8a', '#3b82f6', '#6d28d9', '#c026d3',
  '#831843', '#ec4899', '#78350f', '#b45309',
] as const;

export const BRUSH_SIZES = [4, 10, 20, 40] as const;
