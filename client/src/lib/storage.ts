/**
 * Small localStorage helpers.
 *
 * Two things are remembered: the player's identity (so they don't retype a name
 * every session) and the seat token for the room they're currently in (so a
 * page refresh drops them back into the same game with their score intact).
 */

const IDENTITY_KEY = 'doodl.identity';
const SEAT_KEY = 'doodl.seat';

export interface Identity {
  name: string;
  avatar: string;
}

export interface Seat {
  code: string;
  session: string;
  /**
   * The name the seat was taken with. A reconnect must match it, otherwise a
   * second tab in the same browser joining as a different person would present
   * the first player's token and take their seat out from under them.
   */
  name: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Private browsing, disabled storage, corrupt value — all non-fatal.
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: remembering things is a convenience, not a requirement.
  }
}

export function loadIdentity(): Identity | null {
  const id = read<Identity>(IDENTITY_KEY);
  return id && typeof id.name === 'string' && typeof id.avatar === 'string' ? id : null;
}

export function saveIdentity(identity: Identity): void {
  write(IDENTITY_KEY, identity);
}

export function loadSeat(): Seat | null {
  const seat = read<Seat>(SEAT_KEY);
  return seat &&
    typeof seat.code === 'string' &&
    typeof seat.session === 'string' &&
    typeof seat.name === 'string'
    ? seat
    : null;
}

/** The stored token is only usable for the same room *and* the same name. */
export function seatFor(code: string, name: string): string | undefined {
  const seat = loadSeat();
  if (!seat) return undefined;
  if (seat.code !== code) return undefined;
  if (seat.name.toLowerCase() !== name.toLowerCase()) return undefined;
  return seat.session;
}

export function saveSeat(seat: Seat): void {
  write(SEAT_KEY, seat);
}

export function clearSeat(): void {
  try {
    localStorage.removeItem(SEAT_KEY);
  } catch {
    // Ignore.
  }
}

/** Read a room code from a /r/CODE path, if present. */
export function codeFromUrl(): string {
  const match = /^\/r\/([A-Za-z0-9]{4,8})\/?$/.exec(location.pathname);
  return match ? match[1]!.toUpperCase() : '';
}

export function setUrlForRoom(code: string | null): void {
  const next = code ? `/r/${code}` : '/';
  if (location.pathname !== next) history.replaceState(null, '', next);
}

export function shareUrl(code: string): string {
  return `${location.origin}/r/${code}`;
}
