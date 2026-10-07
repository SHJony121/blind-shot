import type { Vec2 } from '../math/vec';
import type { BotDifficulty, PlayerInfo, PlayerInput, PlayerStats, TeamId } from '../types';

/** Authoritative per-subject state inside a MatchSimulation. Never sent raw over the network. */
export interface SimPlayer {
  id: string;
  name: string;
  subject: number;
  colorIndex: number;
  team: TeamId;
  isBot: boolean;
  botDifficulty: BotDifficulty | null;
  connected: boolean;
  isHost: boolean;
  /** Took part in the current round (false for players who joined late / dropped). */
  inRound: boolean;
  alive: boolean;
  pos: Vec2;
  yaw: number;
  moving: boolean;
  input: PlayerInput;
  lastSeq: number;
  stats: PlayerStats;
}

export const toPlayerInfo = (p: SimPlayer): PlayerInfo => ({
  id: p.id,
  name: p.name,
  subject: p.subject,
  colorIndex: p.colorIndex,
  team: p.team,
  isBot: p.isBot,
  botDifficulty: p.botDifficulty,
  connected: p.connected,
  isHost: p.isHost,
  alive: p.alive,
  inRound: p.inRound,
  stats: { ...p.stats },
});

/** Two subjects are enemies unless they share a non-zero team. */
export const areEnemies = (a: { team: TeamId; id: string }, b: { team: TeamId; id: string }): boolean =>
  a.id !== b.id && (a.team === 0 || a.team !== b.team);
