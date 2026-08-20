import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Room codes use a reduced alphabet with no visually ambiguous characters
 * (no O/0, no I/1/L), because people read these out loud and type them from a
 * screenshot.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;

export function makeRoomCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

/** Public, non-secret identifier for a player within a room. */
export function makePlayerId(): string {
  return randomBytes(6).toString('base64url');
}

/**
 * Secret reconnect token. Holding it proves you are the player who originally
 * took the seat, so it must be unguessable.
 */
export function makeSessionToken(): string {
  return randomUUID();
}
