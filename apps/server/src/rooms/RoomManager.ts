import { generateRoomCode, type MatchConfig, type RoomVisibility } from '@blindshot/shared';
import type { BlindShotServer } from '../networking/types';
import { Room } from './Room';

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly io: BlindShotServer) {}

  create(hostId: string, visibility: RoomVisibility, config: Partial<MatchConfig> = {}): Room {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new Room(this.io, code, visibility, hostId, config, (r) => this.rooms.delete(r.code));
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** Quick Play: a public lobby that is not mid-match and has a free slot. */
  findPublicLobby(): Room | undefined {
    let best: Room | undefined;
    for (const room of this.rooms.values()) {
      if (room.visibility !== 'PUBLIC' || room.inMatch || !room.hasOpenSlot()) continue;
      // Prefer the fullest lobby so matches start sooner.
      if (!best || room.humanCount > best.humanCount) best = room;
    }
    return best;
  }

  get size(): number {
    return this.rooms.size;
  }
}
