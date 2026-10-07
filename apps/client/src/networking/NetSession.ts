import type { MatchEvent, MatchView, PlayerInput } from '@blindshot/shared';
import type { GameSession, SessionListener } from './GameSession';
import type { BlindShotSocket } from './NetClient';

/**
 * Online play: the server is authoritative. This session only forwards input intent and
 * relays the server's filtered snapshots and discrete events to the game controller.
 */
export class NetSession implements GameSession {
  readonly online = true;
  readonly interpolationDelay = 0.1;
  private listener: SessionListener | null = null;
  private readonly backlog: (() => void)[] = [];
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly socket: BlindShotSocket,
    readonly localId: string,
    firstView: MatchView,
  ) {
    const queue = (fn: (l: SessionListener) => void) => {
      if (this.listener) fn(this.listener);
      else this.backlog.push(() => this.listener && fn(this.listener));
    };
    const ev = (type: MatchEvent['type']) => (data: unknown) => queue((l) => l.onEvent({ type, data } as MatchEvent));
    const handlers = {
      snapshot: (v: MatchView) => queue((l) => l.onView(v)),
      phaseChanged: ev('phaseChanged'),
      shootout: ev('shootout'),
      roundEnded: ev('roundEnded'),
      matchEnded: ev('matchEnded'),
    };
    for (const [name, fn] of Object.entries(handlers)) {
      socket.on(name as 'snapshot', fn as (v: MatchView) => void);
      this.offs.push(() => socket.off(name as 'snapshot', fn as (v: MatchView) => void));
    }
    queue((l) => l.onView(firstView));
  }

  setListener(listener: SessionListener): void {
    this.listener = listener;
    for (const fn of this.backlog.splice(0)) fn();
  }

  sendInput(input: PlayerInput): void {
    if (this.socket.connected) this.socket.volatile.emit('playerInput', input);
  }

  update(): void {
    // Server-driven; nothing to step locally.
  }

  setPaused(): void {
    // Online matches cannot be paused.
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.listener = null;
  }
}
