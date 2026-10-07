import { randomBytes, randomUUID } from 'node:crypto';
import { sanitizeName } from '@blindshot/shared';

export interface PlayerRecord {
  id: string;
  token: string;
  name: string;
  socketId: string | null;
  roomCode: string | null;
}

/**
 * Guest identities. A random session token lets a player who dropped (refresh, network
 * blip) reclaim the same player id — and therefore the same seat in a room — on reconnect.
 */
export class PlayerRegistry {
  private readonly byToken = new Map<string, PlayerRecord>();
  private readonly byId = new Map<string, PlayerRecord>();

  /** Resolve a hello: reuse the record behind a valid token, otherwise mint a new guest. */
  identify(rawName: unknown, token: unknown, socketId: string): PlayerRecord {
    const name = sanitizeName(rawName, 'Guest');
    const existing = typeof token === 'string' ? this.byToken.get(token) : undefined;
    if (existing) {
      existing.name = name;
      existing.socketId = socketId;
      return existing;
    }
    const record: PlayerRecord = {
      id: randomUUID(),
      token: randomBytes(18).toString('base64url'),
      name,
      socketId,
      roomCode: null,
    };
    this.byToken.set(record.token, record);
    this.byId.set(record.id, record);
    return record;
  }

  get(id: string): PlayerRecord | undefined {
    return this.byId.get(id);
  }

  /** Forget a player entirely (called once they are no longer in any room). */
  forget(id: string): void {
    const rec = this.byId.get(id);
    if (!rec) return;
    this.byId.delete(id);
    this.byToken.delete(rec.token);
  }
}
