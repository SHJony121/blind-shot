import { normalizeRoomCode, sanitizeInput, type RoomState } from '@blindshot/shared';
import { MAX_INPUTS_PER_SECOND } from '../config';
import type { PlayerRegistry } from '../players/PlayerRegistry';
import type { Room } from '../rooms/Room';
import type { RoomManager } from '../rooms/RoomManager';
import { RateLimiter } from '../validation/RateLimiter';
import type { BlindShotServer, BlindShotSocket } from './types';

const fail = (error: string) => ({ ok: false as const, error });

/**
 * Socket event handlers. Every payload from a client is treated as untrusted:
 * names, codes, configs and inputs are sanitised; clients never report hits.
 */
export function registerHandlers(io: BlindShotServer, rooms: RoomManager, players: PlayerRegistry): void {
  io.on('connection', (socket: BlindShotSocket) => {
    const inputLimiter = new RateLimiter(MAX_INPUTS_PER_SECOND);
    let playerId: string | null = null;

    const currentRoom = (): Room | undefined => {
      const rec = playerId ? players.get(playerId) : undefined;
      return rec?.roomCode ? rooms.get(rec.roomCode) : undefined;
    };

    const leaveCurrent = () => {
      const room = currentRoom();
      const rec = playerId ? players.get(playerId) : undefined;
      if (room && playerId) room.leave(playerId);
      if (rec) rec.roomCode = null;
    };

    const enter = (room: Room): RoomState => {
      const rec = players.get(playerId as string)!;
      if (rec.roomCode && rec.roomCode !== room.code) leaveCurrent();
      rec.roomCode = room.code;
      room.join(rec.id, rec.name, socket.id, rec.skin);
      return room.state();
    };

    socket.on('hello', (payload, ack) => {
      if (typeof ack !== 'function') return;
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as { name?: unknown; token?: unknown; skin?: unknown };
      const rec = players.identify(p.name, p.token, socket.id, p.skin);
      playerId = rec.id;
      socket.data.playerId = rec.id;
      socket.data.name = rec.name;
      ack({ ok: true, data: { playerId: rec.id, token: rec.token, name: rec.name } });
      // Reclaim a seat after a drop.
      const room = currentRoom();
      if (room?.hasMember(rec.id)) room.reconnect(rec.id, socket.id, rec.name);
      else rec.roomCode = null;
    });

    socket.on('quickPlay', (ack) => {
      if (typeof ack !== 'function') return;
      if (!playerId) return ack(fail('SAY HELLO FIRST'));
      const room = rooms.findPublicLobby() ?? rooms.create(playerId, 'PUBLIC');
      ack({ ok: true, data: enter(room) });
    });

    socket.on('createRoom', (config, ack) => {
      if (typeof ack !== 'function') return;
      if (!playerId) return ack(fail('SAY HELLO FIRST'));
      leaveCurrent();
      const room = rooms.create(playerId, 'PRIVATE', typeof config === 'object' && config !== null ? config : {});
      ack({ ok: true, data: enter(room) });
    });

    socket.on('joinRoom', (rawCode, ack) => {
      if (typeof ack !== 'function') return;
      if (!playerId) return ack(fail('SAY HELLO FIRST'));
      const code = normalizeRoomCode(rawCode);
      const room = code ? rooms.get(code) : undefined;
      if (!room) return ack(fail('ROOM NOT FOUND'));
      if (!room.hasMember(playerId)) {
        if (!room.hasOpenSlot()) return ack(fail('ROOM IS FULL'));
      }
      ack({ ok: true, data: enter(room) });
      if (room.inMatch) socket.emit('notice', 'MATCH IN PROGRESS — YOU WILL JOIN NEXT ROUND');
    });

    socket.on('leaveRoom', () => leaveCurrent());

    socket.on('updateRoom', (patch) => {
      if (!playerId || typeof patch !== 'object' || patch === null) return;
      currentRoom()?.update(playerId, patch as { config?: unknown; botFill?: unknown });
    });

    socket.on('playerReady', (ready) => {
      if (!playerId) return;
      currentRoom()?.setReady(playerId, ready === true);
    });

    socket.on('startMatch', (ack) => {
      if (typeof ack !== 'function') return;
      const room = currentRoom();
      if (!room || !playerId) return ack(fail('NOT IN A ROOM'));
      const error = room.start(playerId);
      ack(error ? fail(error) : { ok: true, data: undefined });
    });

    socket.on('returnToLobby', () => {
      currentRoom()?.broadcastState();
    });

    socket.on('playerInput', (raw) => {
      if (!playerId || !inputLimiter.allow()) return;
      const input = sanitizeInput(raw);
      if (!input) return;
      currentRoom()?.input(playerId, input);
    });

    socket.on('disconnect', () => {
      if (!playerId) return;
      const rec = players.get(playerId);
      if (!rec || rec.socketId !== socket.id) return; // a newer socket already took over
      rec.socketId = null;
      const room = currentRoom();
      if (room) room.disconnect(playerId);
      else players.forget(playerId);
    });
  });
}
