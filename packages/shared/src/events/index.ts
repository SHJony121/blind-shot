import type {
  MatchConfig,
  MatchEndedEvent,
  MatchView,
  PhaseChangedEvent,
  PlayerInput,
  RoomState,
  RoundEndedEvent,
  ShotFiredEvent,
} from '../types';

export interface HelloPayload {
  name: string;
  skin?: string;
  /** Session token from a previous connection, used to reclaim a seat after a drop. */
  token?: string;
}

export interface WelcomePayload {
  playerId: string;
  token: string;
  name: string;
}

export type Ack<T = undefined> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

/** CLIENT → SERVER. The client only ever sends intent (input, aim, readiness) — never hit claims. */
export interface ClientToServerEvents {
  hello: (payload: HelloPayload, ack: Ack<WelcomePayload>) => void;
  quickPlay: (ack: Ack<RoomState>) => void;
  createRoom: (config: Partial<MatchConfig>, ack: Ack<RoomState>) => void;
  joinRoom: (code: string, ack: Ack<RoomState>) => void;
  leaveRoom: () => void;
  updateRoom: (patch: { config?: Partial<MatchConfig>; botFill?: number }) => void;
  playerReady: (ready: boolean) => void;
  startMatch: (ack: Ack) => void;
  returnToLobby: () => void;
  playerInput: (input: PlayerInput) => void;
}

/** SERVER → CLIENT. */
export interface ServerToClientEvents {
  roomState: (room: RoomState | null) => void;
  matchStarted: (view: MatchView) => void;
  snapshot: (view: MatchView) => void;
  phaseChanged: (e: PhaseChangedEvent) => void;
  shotFired: (e: ShotFiredEvent) => void;
  roundEnded: (e: RoundEndedEvent) => void;
  matchEnded: (e: MatchEndedEvent) => void;
  notice: (message: string) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  playerId: string;
  name: string;
  roomCode: string | null;
}
