import { LIMITS, isValidRoomCode } from '@syncroom/shared';
import { Room } from './room';

/**
 * Registry of live rooms. Rooms are created on demand and reaped once empty
 * for `ROOM_TTL_EMPTY_MS` — the whole platform is stateless by design.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private reapTimers = new Map<string, NodeJS.Timeout>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  create(code: string): Room | null {
    if (!isValidRoomCode(code) || this.rooms.has(code)) return null;
    const room = new Room(code, this.now);
    this.rooms.set(code, room);
    return room;
  }

  destroy(code: string): void {
    this.cancelReap(code);
    this.rooms.delete(code);
  }

  /** Schedule reaping when a room becomes empty; cancelled if someone joins. */
  scheduleReapIfEmpty(code: string): void {
    const room = this.rooms.get(code);
    if (!room || room.connectedCount > 0) return;
    this.cancelReap(code);
    const timer = setTimeout(() => {
      const r = this.rooms.get(code);
      if (r && r.connectedCount === 0) this.destroy(code);
    }, LIMITS.ROOM_TTL_EMPTY_MS);
    timer.unref?.();
    this.reapTimers.set(code, timer);
  }

  cancelReap(code: string): void {
    const timer = this.reapTimers.get(code);
    if (timer) {
      clearTimeout(timer);
      this.reapTimers.delete(code);
    }
  }

  get count(): number {
    return this.rooms.size;
  }
}
