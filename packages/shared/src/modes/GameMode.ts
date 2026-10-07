import type { ArenaDef } from '../arena/arena';
import type { SimPlayer } from '../sim/SimPlayer';
import type { Rng } from '../util/rng';
import type { MatchConfig, MatchEvent, Phase } from '../types';

/** What a game mode may touch. Owned by MatchSimulation. */
export interface ModeContext {
  readonly config: MatchConfig;
  /** Current (possibly shrunk) arena. */
  readonly arena: ArenaDef;
  /** Shrink / restore the arena (1 = full size). */
  setArenaScale(scale: number): void;
  readonly rng: Rng;
  readonly players: Map<string, SimPlayer>;
  emit(event: MatchEvent): void;
}

/**
 * Reusable mini-game contract. BLIND SHOT is the first implementation; future modes
 * (QUICK DRAW, DOUBLE SHOT, RICOCHET...) plug into MatchSimulation the same way.
 */
export interface GameMode {
  readonly id: string;
  readonly phase: Phase;
  readonly phaseDuration: number;
  readonly phaseElapsed: number;
  readonly round: number;
  readonly shot: number;
  readonly teamWins: Record<number, number>;

  initialize(ctx: ModeContext): void;
  startRound(): void;
  update(dt: number): void;
  endRound(): void;
  cleanup(): void;

  /** Whether subjects may move / aim right now. */
  canMove(): boolean;
  canAim(): boolean;
  /** Called after a player was removed from play (disconnect, kick). */
  onPlayerRemoved(id: string): void;
  isFinished(): boolean;
}
