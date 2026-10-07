import { randomSpawns } from '../../arena/arena';
import {
  MAX_SHOTS_PER_ROUND,
  arenaScaleForRound,
  PHASE_DURATIONS,
  SCORE,
  SHOT_INTERVAL,
  SHOT_LEAD_IN,
  SHOT_TAIL,
  SIMULTANEOUS_SHOOTING_TIME,
} from '../../constants/game';
import { collectEliminations, computeShots, fireOne, type ShooterSnapshot } from '../../sim/shotResolution';
import { toPlayerInfo, type SimPlayer } from '../../sim/SimPlayer';
import { AIM_PHASES, MOVE_PHASES, type Phase, type ShotResult, type TeamId } from '../../types';
import type { GameMode, ModeContext } from '../GameMode';

/** Phases where a disconnect can end the round early. */
const INTERRUPTIBLE: ReadonlySet<Phase> = new Set<Phase>(['ROUND_INTRO', 'SPAWN', 'VISIBLE', 'HIDE', 'COUNTDOWN', 'FREEZE']);

/**
 * BLIND SHOT — the explicit round state machine. Every phase transition in the game
 * happens in `advance()`; nothing else changes `phase`.
 *
 *  ROUND_INTRO → SPAWN → VISIBLE → HIDE → COUNTDOWN → FREEZE → SHOOTING → REVEAL
 *     ↑                    ↑      (enemies hidden,   (all shown,  (one by one,   │
 *     │                    │       "revealed in 5")   aims locked)  or at once)   │
 *     │                    └────────────── more than one side alive ─────────────┤
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
  /** Sequential volley state. */
  private queue: string[] = [];
  private volleyTotal = 0;
  private volleyIndex = 0;
  private nextShotAt = 0;

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
    // Every round the walls close in a little.
    this.ctx.setArenaScale(arenaScaleForRound(this.round));
    const players = [...this.ctx.players.values()];
    const spawns = randomSpawns(
      this.ctx.arena,
      players.map((p) => p.team),
      this.ctx.rng,
    );
    players.forEach((p, i) => {
      p.inRound = p.connected;
      p.alive = p.connected;
      const s = spawns[i];
      if (s) {
        p.pos = { ...s.pos };
        p.yaw = s.yaw;
        p.input = { ...p.input, moveX: 0, moveZ: 0, sprint: false, yaw: s.yaw };
      }
      p.moving = false;
    });
    this.enter('ROUND_INTRO', PHASE_DURATIONS.ROUND_INTRO);
  }

  update(dt: number): void {
    if (this.phase === 'WAITING' || this.phase === 'MATCH_END') return;
    this.phaseElapsed += dt;
    if (this.phase === 'SHOOTING') this.updateShooting();
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
    return MOVE_PHASES.has(this.phase);
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
        return this.enter('COUNTDOWN', config.blindSeconds);
      case 'COUNTDOWN':
        return this.enter('FREEZE', PHASE_DURATIONS.FREEZE);
      case 'FREEZE':
        return this.beginShooting();
      case 'SHOOTING':
        if (config.fireOrder === 'SEQUENTIAL') this.awardSurvivors(this.alivePlayers());
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

  /** Aims were locked when FREEZE began. Now the volley plays out. */
  private beginShooting(): void {
    const shooters = this.alivePlayers();
    if (this.ctx.config.fireOrder === 'SIMULTANEOUS') {
      this.enter('SHOOTING', SIMULTANEOUS_SHOOTING_TIME);
      this.fireSimultaneous(shooters);
      return;
    }
    // Random order every volley, so nobody is always first.
    this.queue = shooters.map((p) => p.id);
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = this.ctx.rng.int(0, i);
      [this.queue[i], this.queue[j]] = [this.queue[j] as string, this.queue[i] as string];
    }
    this.volleyTotal = this.queue.length;
    this.volleyIndex = 0;
    this.nextShotAt = SHOT_LEAD_IN;
    this.enter('SHOOTING', SHOT_LEAD_IN + this.queue.length * SHOT_INTERVAL + SHOT_TAIL);
  }

  /** Sequential order: one subject fires every SHOT_INTERVAL. Eliminated subjects lose their turn. */
  private updateShooting(): void {
    if (this.ctx.config.fireOrder !== 'SEQUENTIAL') return;
    while (this.queue.length > 0 && this.phaseElapsed >= this.nextShotAt) {
      const id = this.queue.shift() as string;
      const shooter = this.ctx.players.get(id);
      if (!shooter || !shooter.alive) continue; // already shot down: no turn, no time spent
      const alive = this.alivePlayers().map(snap);
      const result = fireOne(this.ctx.arena, snap(shooter), alive, this.ctx.config.friendlyFire);
      const eliminated = result.hitPlayerId ? [result.hitPlayerId] : [];
      this.applyShot(result);
      for (const victim of eliminated) this.eliminate(victim);
      this.emitShot(result, eliminated, false);
      this.nextShotAt += SHOT_INTERVAL;
      // Only one side left: skip the remaining (pointless) shots.
      if (this.aliveSides().length <= 1) {
        this.queue = [];
        this.phaseDuration = Math.min(this.phaseDuration, this.phaseElapsed + SHOT_TAIL);
      }
    }
  }

  /** Simultaneous order: compute every shot from one snapshot, then apply all eliminations at once. */
  private fireSimultaneous(shooters: SimPlayer[]): void {
    const snapshot = shooters.map(snap);
    const shots = computeShots(this.ctx.arena, snapshot, this.ctx.config.friendlyFire);
    const eliminated = collectEliminations(shots);
    this.volleyTotal = shots.length;
    this.volleyIndex = 0;
    for (const s of shots) this.applyShot(s);
    for (const id of eliminated) this.eliminate(id);
    for (const s of shots) this.emitShot(s, s.hitPlayerId ? [s.hitPlayerId] : [], true);
    this.awardSurvivors(shooters);
  }

  private applyShot(s: ShotResult): void {
    const shooter = this.ctx.players.get(s.shooterId);
    if (!shooter) return;
    shooter.stats.shots += 1;
    if (s.hitPlayerId) {
      shooter.stats.hits += 1;
      shooter.stats.kills += 1;
      shooter.stats.score += SCORE.HIT + SCORE.ELIMINATION;
    }
  }

  private eliminate(id: string): void {
    const p = this.ctx.players.get(id);
    if (!p || !p.alive) return;
    p.alive = false;
    p.stats.deaths += 1;
  }

  private awardSurvivors(volley: SimPlayer[]): void {
    for (const p of volley) {
      if (!p.alive) continue;
      p.stats.shotsSurvived += 1;
      p.stats.score += SCORE.SURVIVAL;
    }
  }

  private emitShot(result: ShotResult, eliminated: string[], simultaneous: boolean): void {
    const index = this.volleyIndex++;
    this.ctx.emit({
      type: 'shotFired',
      data: { round: this.round, shot: this.shot, index, total: this.volleyTotal, result, eliminated, simultaneous },
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

const snap = (p: SimPlayer): ShooterSnapshot => ({ id: p.id, team: p.team, pos: { x: p.pos.x, z: p.pos.z }, yaw: p.yaw });
