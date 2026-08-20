/**
 * The room registry: the entire persistence layer.
 *
 * A single `Map<roomCode, Room>` holds every game in the process. There is no
 * database and no cache — rooms are ephemeral and a restart drops them.
 *
 * NOTE ON SCALING OUT: a room is sticky to one process, because its state only
 * exists in that process's heap. Running more than one machine requires routing
 * every request for a room code back to the machine that owns it — on Fly that
 * means replying to the upgrade with a `fly-replay` header keyed on the room
 * code. See the README. Do not try to share room state between machines.
 */

import { makeRoomCode } from './ids.js';
import { Room } from './room.js';

/** Belt-and-braces ceiling so one process can't be trivially memory-exhausted. */
const MAX_ROOMS = 5000;
const SWEEP_INTERVAL_MS = 15_000;

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout | null = null;

  get size(): number {
    return this.rooms.size;
  }

  get playerCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.size;
    return total;
  }

  get isFull(): boolean {
    return this.rooms.size >= MAX_ROOMS;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  create(): Room | null {
    if (this.isFull) return null;

    // Retry on the vanishingly unlikely collision rather than trusting luck.
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = makeRoomCode();
      if (this.rooms.has(code)) continue;
      const room = new Room(code);
      this.rooms.set(code, room);
      return room;
    }
    return null;
  }

  /** Expire dead seats and drop rooms nobody has been in for a while. */
  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      let done = false;
      try {
        done = room.sweep(now);
      } catch (err) {
        console.error(`[registry] sweep failed for room ${code}`, err);
        done = true;
      }
      if (done) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }

  start(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
