import type { MatchEvent, MatchView, PlayerInput } from '@blindshot/shared';

export interface SessionListener {
  onView(view: MatchView): void;
  onEvent(event: MatchEvent): void;
}

/**
 * The game client talks to a session, never directly to a simulation or a socket.
 * LocalSession runs the shared simulation in the tab (solo); NetSession talks to the
 * authoritative server. The renderer cannot tell the difference.
 */
export interface GameSession {
  readonly online: boolean;
  readonly localId: string;
  /** Seconds of interpolation delay to apply to remote subjects. */
  readonly interpolationDelay: number;
  setListener(listener: SessionListener): void;
  sendInput(input: PlayerInput): void;
  update(dt: number): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}
