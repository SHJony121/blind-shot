import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  MatchConfig,
  MatchView,
  RoomState,
  ServerToClientEvents,
  WelcomePayload,
} from '@blindshot/shared';
import { settingsStore } from '../state/settings';
import { Store } from '../state/store';

export type BlindShotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface NetState {
  status: 'offline' | 'connecting' | 'online' | 'error';
  playerId: string | null;
  room: RoomState | null;
  error: string | null;
  notice: string | null;
}

const TOKEN_KEY = 'blindshot.session';

function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:3001`;
  return location.origin;
}

function readToken(): string | undefined {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Reconnect-after-refresh simply won't work without storage.
  }
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Connection + room management for online play (Socket.IO). */
export class NetClient {
  readonly store = new Store<NetState>({ status: 'offline', playerId: null, room: null, error: null, notice: null });
  socket: BlindShotSocket | null = null;
  private name = '';
  private matchStartedHandler: ((view: MatchView) => void) | null = null;

  onMatchStarted(handler: (view: MatchView) => void): void {
    this.matchStartedHandler = handler;
  }

  async connect(name: string): Promise<boolean> {
    this.name = name;
    if (this.socket?.connected) {
      await this.hello();
      return true;
    }
    this.store.set({ status: 'connecting', error: null });
    const socket: BlindShotSocket = io(serverUrl(), { transports: ['websocket', 'polling'], reconnectionAttempts: 8, timeout: 6000 });
    this.socket = socket;

    socket.on('roomState', (room) => this.store.set({ room }));
    socket.on('notice', (notice) => {
      this.store.set({ notice });
      setTimeout(() => {
        if (this.store.get().notice === notice) this.store.set({ notice: null });
      }, 4000);
    });
    socket.on('matchStarted', (view) => this.matchStartedHandler?.(view));
    socket.on('disconnect', () => this.store.set({ status: 'connecting' }));
    socket.io.on('reconnect', () => void this.hello());

    const ok = await new Promise<boolean>((resolve) => {
      socket.once('connect', () => resolve(true));
      socket.once('connect_error', () => resolve(false));
    });
    if (!ok) {
      this.store.set({ status: 'error', error: 'CANNOT REACH THE TEST FACILITY SERVER' });
      socket.disconnect();
      this.socket = null;
      return false;
    }
    await this.hello();
    return true;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.store.set({ status: 'offline', room: null, playerId: null });
  }

  quickPlay(): Promise<Result<RoomState>> {
    return this.call((s, ack) => s.emit('quickPlay', ack));
  }

  createRoom(config: Partial<MatchConfig>): Promise<Result<RoomState>> {
    return this.call((s, ack) => s.emit('createRoom', config, ack));
  }

  joinRoom(code: string): Promise<Result<RoomState>> {
    return this.call((s, ack) => s.emit('joinRoom', code, ack));
  }

  leaveRoom(): void {
    this.socket?.emit('leaveRoom');
    this.store.set({ room: null });
  }

  updateRoom(patch: { config?: Partial<MatchConfig>; botFill?: number }): void {
    this.socket?.emit('updateRoom', patch);
  }

  setReady(ready: boolean): void {
    this.socket?.emit('playerReady', ready);
  }

  startMatch(): Promise<Result<undefined>> {
    return this.call((s, ack) => s.emit('startMatch', ack));
  }

  returnToLobby(): void {
    this.socket?.emit('returnToLobby');
  }

  private async hello(): Promise<void> {
    const res = await this.call<WelcomePayload>((s, ack) => s.emit('hello', { name: this.name, skin: settingsStore.get().skin, token: readToken() }, ack));
    if (res.ok) {
      writeToken(res.data.token);
      this.store.set({ status: 'online', playerId: res.data.playerId, error: null });
    } else {
      this.store.set({ status: 'error', error: res.error });
    }
  }

  private call<T>(fn: (socket: BlindShotSocket, ack: (r: Result<T>) => void) => void): Promise<Result<T>> {
    const socket = this.socket;
    if (!socket) return Promise.resolve({ ok: false, error: 'NOT CONNECTED' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'SERVER TIMEOUT' }), 6000);
      fn(socket, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
    });
  }
}

export const net = new NetClient();
