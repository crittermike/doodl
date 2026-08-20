/**
 * Inbound message validation.
 *
 * Every field of every client message is checked here before it reaches the
 * game logic. Clients are assumed hostile: nothing downstream may assume a
 * value has the right type, is in range, or is even present.
 *
 * Validation is hand-written rather than schema-driven. There are only a dozen
 * message types, the rules are specific (quantized point ranges, palette
 * membership, name sanitisation), and it keeps the server dependency-free
 * apart from `ws`.
 */

import {
  AVATARS,
  MAX_BRUSH_WIDTH,
  MAX_CHAT_LEN,
  MAX_CUSTOM_WORDS,
  MAX_DRAW_TIME,
  MAX_HINTS,
  MAX_MAX_PLAYERS,
  MAX_NAME_LEN,
  MAX_POINTS_PER_MSG,
  MAX_ROOM_CODE_LEN,
  MAX_ROUNDS,
  MAX_WORD_LEN,
  MIN_BRUSH_WIDTH,
  MIN_DRAW_TIME,
  MIN_MAX_PLAYERS,
  MIN_ROUNDS,
  WORD_CHOICES,
  isValidQPoint,
  type ClientMessage,
  type QPoint,
  type RoomSettings,
  type Tool,
} from '@doodl/shared';

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T>(value: T): Validated<T> => ({ ok: true, value });
const bad = (reason: string): Validated<never> => ({ ok: false, reason });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Strip anything that lets a display name break the UI or impersonate another
 * player: control characters, bidi overrides, zero-width joiners and runs of
 * whitespace.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN);
}

export function sanitizeChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHAT_LEN);
}

export function normalizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_ROOM_CODE_LEN);
}

function validAvatar(raw: unknown): string | null {
  return typeof raw === 'string' && (AVATARS as readonly string[]).includes(raw) ? raw : null;
}

function validColor(raw: unknown): string | null {
  return typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null;
}

function validTool(raw: unknown): Tool | null {
  return raw === 'brush' || raw === 'eraser' ? raw : null;
}

function intInRange(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= min && raw <= max ? raw : null;
}

function validPoints(raw: unknown): QPoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_POINTS_PER_MSG) return null;
  for (const p of raw) {
    if (!isValidQPoint(p)) return null;
  }
  return raw as QPoint[];
}

/**
 * Validate a partial settings patch. Unknown keys are ignored; known keys with
 * bad values reject the whole patch so the host gets clear feedback rather than
 * a silently half-applied change.
 */
export function validateSettings(raw: unknown): Validated<Partial<RoomSettings>> {
  if (!isRecord(raw)) return bad('settings must be an object');
  const out: Partial<RoomSettings> = {};

  if (raw.rounds !== undefined) {
    const v = intInRange(raw.rounds, MIN_ROUNDS, MAX_ROUNDS);
    if (v === null) return bad(`rounds must be an integer between ${MIN_ROUNDS} and ${MAX_ROUNDS}`);
    out.rounds = v;
  }

  if (raw.drawTime !== undefined) {
    const v = intInRange(raw.drawTime, MIN_DRAW_TIME, MAX_DRAW_TIME);
    if (v === null) return bad(`drawTime must be between ${MIN_DRAW_TIME} and ${MAX_DRAW_TIME} seconds`);
    out.drawTime = v;
  }

  if (raw.maxPlayers !== undefined) {
    const v = intInRange(raw.maxPlayers, MIN_MAX_PLAYERS, MAX_MAX_PLAYERS);
    if (v === null) return bad(`maxPlayers must be between ${MIN_MAX_PLAYERS} and ${MAX_MAX_PLAYERS}`);
    out.maxPlayers = v;
  }

  if (raw.hints !== undefined) {
    const v = intInRange(raw.hints, 0, MAX_HINTS);
    if (v === null) return bad(`hints must be between 0 and ${MAX_HINTS}`);
    out.hints = v;
  }

  if (raw.customWordsOnly !== undefined) {
    if (typeof raw.customWordsOnly !== 'boolean') return bad('customWordsOnly must be a boolean');
    out.customWordsOnly = raw.customWordsOnly;
  }

  if (raw.customWords !== undefined) {
    if (!Array.isArray(raw.customWords)) return bad('customWords must be an array');
    if (raw.customWords.length > MAX_CUSTOM_WORDS) {
      return bad(`customWords is limited to ${MAX_CUSTOM_WORDS} entries`);
    }
    const words: string[] = [];
    const seen = new Set<string>();
    for (const w of raw.customWords) {
      if (typeof w !== 'string') return bad('customWords must contain only strings');
      const word = w.replace(/\s+/g, ' ').trim().slice(0, MAX_WORD_LEN);
      if (!word) continue;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(word);
    }
    out.customWords = words;
  }

  return ok(out);
}

/**
 * Parse and validate a raw inbound frame.
 *
 * Returns the message narrowed to `ClientMessage` on success. Callers must
 * still enforce *authorization* (is this player the host? the drawer?) — that
 * depends on room state and lives in `Room`.
 */
export function parseClientMessage(raw: string): Validated<ClientMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return bad('malformed JSON');
  }

  if (!isRecord(parsed)) return bad('message must be an object');
  const t = parsed.t;
  if (typeof t !== 'string') return bad('missing message type');

  switch (t) {
    case 'create': {
      const name = sanitizeName(parsed.name);
      if (!name) return bad('a display name is required');
      const avatar = validAvatar(parsed.avatar);
      if (!avatar) return bad('unknown avatar');
      return ok({ t: 'create', name, avatar });
    }

    case 'join': {
      const name = sanitizeName(parsed.name);
      if (!name) return bad('a display name is required');
      const avatar = validAvatar(parsed.avatar);
      if (!avatar) return bad('unknown avatar');
      const code = normalizeRoomCode(parsed.code);
      if (code.length < 4) return bad('invalid room code');
      const session =
        typeof parsed.session === 'string' && parsed.session.length <= 64 ? parsed.session : undefined;
      return ok(session ? { t: 'join', name, avatar, code, session } : { t: 'join', name, avatar, code });
    }

    case 'settings': {
      const res = validateSettings(parsed.settings);
      if (!res.ok) return res;
      return ok({ t: 'settings', settings: res.value });
    }

    case 'start':
      return ok({ t: 'start' });

    case 'playAgain':
      return ok({ t: 'playAgain' });

    case 'undo':
      return ok({ t: 'undo' });

    case 'clear':
      return ok({ t: 'clear' });

    case 'kick': {
      if (typeof parsed.playerId !== 'string' || parsed.playerId.length > 64) {
        return bad('invalid player id');
      }
      return ok({ t: 'kick', playerId: parsed.playerId });
    }

    case 'pick': {
      const index = intInRange(parsed.index, 0, WORD_CHOICES - 1);
      if (index === null) return bad('invalid word choice');
      return ok({ t: 'pick', index });
    }

    case 'stroke': {
      const pts = validPoints(parsed.pts);
      if (!pts) return bad('invalid stroke points');
      const color = validColor(parsed.color);
      if (!color) return bad('invalid colour');
      const width = intInRange(parsed.width, MIN_BRUSH_WIDTH, MAX_BRUSH_WIDTH);
      if (width === null) return bad('invalid brush width');
      const tool = validTool(parsed.tool);
      if (!tool) return bad('invalid tool');
      const sid = intInRange(parsed.sid, 0, 0x7fffffff);
      if (sid === null) return bad('invalid stroke id');
      return ok({ t: 'stroke', pts, color, width, tool, sid });
    }

    case 'fill': {
      if (!isValidQPoint(parsed.pt)) return bad('invalid fill point');
      const color = validColor(parsed.color);
      if (!color) return bad('invalid colour');
      return ok({ t: 'fill', pt: parsed.pt, color });
    }

    case 'chat': {
      const text = sanitizeChat(parsed.text);
      if (!text) return bad('empty message');
      return ok({ t: 'chat', text });
    }

    default:
      return bad(`unknown message type "${t}"`);
  }
}
