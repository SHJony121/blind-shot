import { spawnPads } from '../../arena/arena';
import { MAX_SHOTS_PER_ROUND, PHASE_DURATIONS, SCORE } from '../../constants/game';
import { collectEliminations, computeShots, type ShooterSnapshot } from '../../sim/shotResolution';
import { toPlayerInfo, type SimPlayer } from '../../sim/SimPlayer';
import { AIM_PHASES, MOVE_PHASES, type Phase, type TeamId } from '../../types';
import type { GameMode, ModeContext } from '../GameMode';

/** Phases where a disconnect can end the round early. */
const INTERRUPTIBLE: ReadonlySet<Phase> = new Set<Phase>(['ROUND_INTRO', 'SPAWN', 'VISIBLE', 'HIDE', 'BLIND', 'COUNTDOWN']);

/**
 * BLIND SHOT — the explicit round state machine. Every phase transition in the game
 * happens in `advance()`; nothing else changes `phase`.
 *
 *  ROUND_INTRO → SPAWN → VISIBLE → HIDE → BLIND → COUNTDOWN → FIRE → RESOLUTION → REVEAL
 *     ↑                     ↑                                                    │
 *     │                     └──────────── more than one side alive ──────────────┤
 *     └──────────────── ROUND_RESULTS ←──────── one / zero sides alive ──────────┘
 *                            └→ MATCH_END when someone reaches roundsToWin
 */
export class BlindShotMode implements GameMode {
  readonly id = 'BLIND_SHOT';
  phase: Phase = 'WAITING';
  phaseDuration = 0;
  phaseElapsed = 0;
  round = 0;
  shot = 0;
  teamWins: Record<number, number> = {};

  private ctx!: ModeContext;
  private matchOver = false;

  initialize(ctx: ModeContext): void {
    this.ctx = ctx;
    this.round = 0;
    this.shot = 0;
    this.matchOver = false;
    this.teamWins = ctx.config.mode === 'TEAMS' ? { 1: 0, 2: 0 } : {};
    this.phase = 'WAITING';
  }

  startRound(): void {
    this.round += 1;
    this.shot = 1;
    const pads = spawnPads(this.ctx.arena, this.ctx.players.size);
    for (const p of this.ctx.players.values()) {
      p.inRound = p.connected;
      p.alive = p.connected;
      const pad = pads[p.padIndex] ?? pads[0];
      if (pad) {
        p.pos = { x: pad.pos.x, z: pad.pos.z };
        p.yaw = pad.yaw;
        p.input = { ...p.input, moveX: 0, moveZ: 0, sprint: false, yaw: pad.yaw };
      }
      p.moving = false;
    }
    this.enter('ROUND_INTRO', PHASE_DURATIONS.ROUND_INTRO);
  }

  update(dt: number): void {
    if (this.phase === 'WAITING' || this.phase === 'MATCH_END') return;
    this.phaseElapsed += dt;
    if (this.phaseElapsed >= this.phaseDuration) this.advance();
  }

  endRound(): void {
    const sides = this.aliveSides();
    const draw = sides.length !== 1;
    let winnerIds: string[] = [];
    let winnerTeam: TeamId = 0;
    if (!draw) {
      const side = sides[0] as string;
      if (this.ctx.config.mode === 'TEAMS') {
        winnerTeam = Number(side) as TeamId;
        this.teamWins[winnerTeam] = (this.teamWins[winnerTeam] ?? 0) + 1;
        winnerIds = [...this.ctx.players.values()].filter((p) => p.team === winnerTeam && p.inRound).map((p) => p.id);
      } else {
        winnerIds = [side];
      }
      for (const id of winnerIds) {
        const p = this.ctx.players.get(id);
        if (!p) continue;
        p.stats.roundWins += 1;
        p.stats.score += SCORE.ROUND_WIN;
      }
    }
    this.matchOver = this.findMatchWinner() !== null;
    this.ctx.emit({
      type: 'roundEnded',
      data: {
        round: this.round,
        draw,
        winnerIds,
        winnerTeam,
        teamWins: { ...this.teamWins },
        roster: this.roster(),
        matchOver: this.matchOver,
      },
    });
    this.enter('ROUND_RESULTS', PHASE_DURATIONS.ROUND_RESULTS);
  }

  cleanup(): void {
    this.phase = 'WAITING';
  }

  canMove(): boolean {
    return MOVE_PHASES.has(this.phase) && this.ctx.config.movement === 'LIGHT';
  }

  canAim(): boolean {
    return AIM_PHASES.has(this.phase);
  }

  onPlayerRemoved(id: string): void {
    const p = this.ctx.players.get(id);
    if (p) p.alive = false;
    if (INTERRUPTIBLE.has(this.phase) && this.aliveSides().length <= 1) this.endRound();
  }

  isFinished(): boolean {
    return this.phase === 'MATCH_END';
  }

  // ---------------------------------------------------------------------------

  private advance(): void {
    const { config } = this.ctx;
    switch (this.phase) {
      case 'ROUND_INTRO':
        return this.enter('SPAWN', PHASE_DURATIONS.SPAWN);
      case 'SPAWN':
        return this.enter('VISIBLE', config.visibleSeconds);
      case 'VISIBLE':
        return this.enter('HIDE', PHASE_DURATIONS.HIDE);
      case 'HIDE':
        return this.enter('BLIND', PHASE_DURATIONS.BLIND);
      case 'BLIND':
        return this.enter('COUNTDOWN', config.blindSeconds);
      case 'COUNTDOWN':
        this.enter('FIRE', PHASE_DURATIONS.FIRE);
        return this.fire();
      case 'FIRE':
        return this.enter('RESOLUTION', PHASE_DURATIONS.RESOLUTION);
      case 'RESOLUTION':
        return this.enter('REVEAL', PHASE_DURATIONS.REVEAL);
      case 'REVEAL':
        if (this.aliveSides().length <= 1 || this.shot >= MAX_SHOTS_PER_ROUND) return this.endRound();
        this.shot += 1;
        return this.enter('VISIBLE', config.visibleSeconds);
      case 'ROUND_RESULTS':
        if (this.matchOver) return this.endMatch();
        return this.startRound();
      default:
        return undefined;
    }
  }

  private enter(phase: Phase, duration: number): void {
    this.phase = phase;
    this.phaseDuration = duration;
    this.phaseElapsed = 0;
    this.ctx.emit({
      type: 'phaseChanged',
      data: {
        phase,
        round: this.round,
        shot: this.shot,
        duration,
        aliveCount: this.alivePlayers().length,
      },
    });
  }

  /** Simultaneous shootout: snapshot → compute all shots → apply all eliminations at once. */
  private fire(): void {
    const shooters = this.alivePlayers();
    const snapshot: ShooterSnapshot[] = shooters.map((p) => ({
      id: p.id,
      team: p.team,
      pos: { x: p.pos.x, z: p.pos.z },
      yaw: p.yaw,
    }));

    // Step 1: compute (pure).
    const shots = computeShots(this.ctx.arena, snapshot, this.ctx.config.friendlyFire);
    const eliminated = collectEliminations(shots);

    // Step 2: apply simultaneously.
    for (const s of shots) {
      const shooter = this.ctx.players.get(s.shooterId);
      if (!shooter) continue;
      shooter.stats.shots += 1;
      if (s.hitPlayerId) {
        shooter.stats.hits += 1;
        shooter.stats.kills += 1;
        shooter.stats.score += SCORE.HIT + SCORE.ELIMINATION;
      }
    }
    const dead = new Set(eliminated);
    for (const p of shooters) {
      if (dead.has(p.id)) {
        p.alive = false;
        p.stats.deaths += 1;
      } else {
        p.stats.shotsSurvived += 1;
        p.stats.score += SCORE.SURVIVAL;
      }
    }

    this.ctx.emit({
      type: 'shootout',
      data: {
        round: this.round,
        shot: this.shot,
        revealed: shooters.map((p) => ({
          id: p.id,
          pos: { x: p.pos.x, z: p.pos.z },
          yaw: p.yaw,
          alive: !dead.has(p.id),
          moving: false,
          visibility: 'full' as const,
        })),
        shots,
        eliminated,
      },
    });
  }

  private endMatch(): void {
    const winner = this.findMatchWinner();
    const roster = this.roster();
    let winnerIds: string[] = [];
    let winnerTeam: TeamId = 0;
    if (winner !== null) {
      if (this.ctx.config.mode === 'TEAMS') {
        winnerTeam = winner as TeamId;
        winnerIds = roster.filter((p) => p.team === winnerTeam).map((p) => p.id);
      } else {
        winnerIds = [String(winner)];
      }
    }
    this.enter('MATCH_END', 0);
    this.ctx.emit({
      type: 'matchEnded',
      data: { draw: winner === null, winnerIds, winnerTeam, roster, teamWins: { ...this.teamWins } },
    });
  }

  /** FFA: player id of the winner; TEAMS: team number; null when nobody has won yet. */
  private findMatchWinner(): string | number | null {
    const need = this.ctx.config.roundsToWin;
    if (this.ctx.config.mode === 'TEAMS') {
      for (const t of [1, 2]) if ((this.teamWins[t] ?? 0) >= need) return t;
      return null;
    }
    for (const p of this.ctx.players.values()) if (p.stats.roundWins >= need) return p.id;
    return null;
  }

  private alivePlayers(): SimPlayer[] {
    return [...this.ctx.players.values()].filter((p) => p.alive && p.inRound);
  }

  /** Distinct sides with at least one living subject: team numbers in TEAMS, player ids in FFA. */
  private aliveSides(): string[] {
    const sides = new Set<string>();
    for (const p of this.alivePlayers()) sides.add(this.ctx.config.mode === 'TEAMS' ? String(p.team) : p.id);
    return [...sides];
  }

  private roster() {
    return [...this.ctx.players.values()].map(toPlayerInfo);
  }
}
