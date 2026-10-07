import type { Vec2 } from '../math/vec';

export type Phase =
  | 'WAITING'
  | 'ROUND_INTRO'
  | 'SPAWN'
  | 'VISIBLE'
  | 'HIDE'
  | 'BLIND'
  | 'COUNTDOWN'
  | 'FIRE'
  | 'RESOLUTION'
  | 'REVEAL'
  | 'ROUND_RESULTS'
  | 'MATCH_END';

/** Phases during which enemies are hidden from every viewer. */
export const HIDDEN_PHASES: ReadonlySet<Phase> = new Set<Phase>(['HIDE', 'BLIND', 'COUNTDOWN']);
/** Phases during which subjects can rotate / aim. */
export const AIM_PHASES: ReadonlySet<Phase> = new Set<Phase>(['VISIBLE', 'HIDE', 'BLIND', 'COUNTDOWN']);
/** Phases during which subjects can move (if the match allows movement). */
export const MOVE_PHASES: ReadonlySet<Phase> = AIM_PHASES;

export type BotDifficulty = 'EASY' | 'NORMAL' | 'HARD';
export type GameModeId = 'FFA' | 'TEAMS';
export type MovementMode = 'LIGHT' | 'FIXED';
export type MapId = 'TEST_CHAMBER_01';
export type TeamId = 0 | 1 | 2;

export interface MatchConfig {
  mode: GameModeId;
  maxPlayers: number;
  roundsToWin: number;
  visibleSeconds: number;
  blindSeconds: number;
  movement: MovementMode;
  friendlyFire: boolean;
  mapId: MapId;
  /** Difficulty used for bots added to this match. */
  botDifficulty: BotDifficulty;
}

export interface PlayerStats {
  score: number;
  shots: number;
  hits: number;
  kills: number;
  deaths: number;
  roundWins: number;
  shotsSurvived: number;
}

export interface PlayerInput {
  seq: number;
  /** Desired movement in world space; magnitude is clamped to 1. */
  moveX: number;
  moveZ: number;
  sprint: boolean;
  yaw: number;
}

/** Public info about a subject. Contains NO position data, so it is safe to send at any time. */
export interface PlayerInfo {
  id: string;
  name: string;
  subject: number;
  colorIndex: number;
  team: TeamId;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  connected: boolean;
  isHost: boolean;
  alive: boolean;
  stats: PlayerStats;
}

export type BodyVisibility = 'full' | 'ghost';

/** Spatial state of a subject. Only included in a view when the viewer is allowed to see it. */
export interface BodyState {
  id: string;
  pos: Vec2;
  yaw: number;
  alive: boolean;
  moving: boolean;
  visibility: BodyVisibility;
}

export interface MatchView {
  /** Viewer this view was built for. */
  viewerId: string;
  time: number;
  phase: Phase;
  phaseDuration: number;
  phaseRemaining: number;
  round: number;
  shot: number;
  roster: PlayerInfo[];
  bodies: BodyState[];
  teamWins: Record<number, number>;
  config: MatchConfig;
  /** Last processed input sequence for the viewer (for client reconciliation). */
  ackSeq: number;
}

export type HitZone = 'BODY' | 'HEAD';

export interface ShotResult {
  shooterId: string;
  origin: Vec2;
  dir: Vec2;
  end: Vec2;
  distance: number;
  hitPlayerId: string | null;
  hitZone: HitZone | null;
  /** What stopped the bullet. */
  hitSurface: 'WALL' | 'PILLAR' | 'SUBJECT' | 'NONE';
}

export interface ShootoutEvent {
  round: number;
  shot: number;
  /** Ground-truth positions of every subject that was alive at fire time (the reveal). */
  revealed: BodyState[];
  shots: ShotResult[];
  eliminated: string[];
}

export interface RoundEndedEvent {
  round: number;
  draw: boolean;
  winnerIds: string[];
  winnerTeam: TeamId;
  teamWins: Record<number, number>;
  roster: PlayerInfo[];
  matchOver: boolean;
}

export interface MatchEndedEvent {
  draw: boolean;
  winnerIds: string[];
  winnerTeam: TeamId;
  roster: PlayerInfo[];
  teamWins: Record<number, number>;
}

export interface PhaseChangedEvent {
  phase: Phase;
  round: number;
  shot: number;
  duration: number;
  aliveCount: number;
}

export type MatchEvent =
  | { type: 'phaseChanged'; data: PhaseChangedEvent }
  | { type: 'shootout'; data: ShootoutEvent }
  | { type: 'roundEnded'; data: RoundEndedEvent }
  | { type: 'matchEnded'; data: MatchEndedEvent };

export interface PlayerSeed {
  id: string;
  name: string;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  isHost?: boolean;
  /** Optional explicit team (TEAMS mode). Assigned automatically when omitted. */
  team?: TeamId;
}

export type RoomVisibility = 'PUBLIC' | 'PRIVATE';

export interface RoomMember {
  id: string;
  name: string;
  isBot: boolean;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  team: TeamId;
}

export interface RoomState {
  code: string;
  visibility: RoomVisibility;
  hostId: string;
  members: RoomMember[];
  config: MatchConfig;
  /** Bots the host wants added when the match starts. */
  botFill: number;
  inMatch: boolean;
}
