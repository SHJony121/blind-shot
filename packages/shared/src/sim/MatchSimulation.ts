import { getArena, scaleArena, type ArenaDef } from '../arena/arena';
import { BotBrain } from '../bots/BotBrain';
import { SKINS, SUBJECT_COLORS, isSkin } from '../constants/game';
import { emptyStats } from '../gameState/config';
import { BlindShotMode } from '../modes/blindShot/BlindShotMode';
import type { GameMode, ModeContext } from '../modes/GameMode';
import { Rng } from '../util/rng';
import type { MatchConfig, MatchEvent, MatchView, Phase, PlayerInput, PlayerSeed, TeamId } from '../types';
import { stepMovement } from './movement';
import { toPlayerInfo, type SimPlayer } from './SimPlayer';
import { visibleBodies } from './visibility';

const MAX_QUEUED_INPUTS = 6;

/**
 * Authoritative match simulation. Runs in the browser for solo play and on the server
 * for online play — the exact same code in both places.
 */
export class MatchSimulation {
  /** Current arena (shrinks each round); `baseArena` is the full-size map. */
  arena: ArenaDef;
  arenaScale = 1;
  readonly baseArena: ArenaDef;
  readonly players = new Map<string, SimPlayer>();
  time = 0;

  private readonly rng: Rng;
  private readonly mode: GameMode;
  private readonly bots = new Map<string, BotBrain>();
  private events: MatchEvent[] = [];
  private readonly inputQueues = new Map<string, PlayerInput[]>();

  constructor(
    readonly config: MatchConfig,
    seeds: readonly PlayerSeed[],
    seed: number = Date.now(),
  ) {
    this.baseArena = getArena(config.mapId);
    this.arena = this.baseArena;
    this.rng = new Rng(seed);
    this.mode = new BlindShotMode();

    const ordered = this.assignTeams(seeds);
    ordered.forEach(({ seed: s, team }) => {
      const subjectIndex = seeds.indexOf(s);
      const player: SimPlayer = {
        id: s.id,
        name: s.name,
        subject: subjectIndex + 1,
        colorIndex: subjectIndex % SUBJECT_COLORS.length,
        skin: isSkin(s.skin) ? s.skin : s.isBot ? (this.rng.pick(SKINS) ?? 'DUMMY') : 'DUMMY',
        team,
        isBot: s.isBot,
        botDifficulty: s.isBot ? s.botDifficulty ?? config.botDifficulty : null,
        connected: true,
        isHost: s.isHost ?? false,
        inRound: false,
        alive: false,
        pos: { x: 0, z: 0 },
        yaw: 0,
        moving: false,
        input: { seq: 0, moveX: 0, moveZ: 0, sprint: false, yaw: 0 },
        lastSeq: 0,
        stats: emptyStats(),
      };
      this.players.set(player.id, player);
      if (player.isBot) {
        const diff = player.botDifficulty ?? 'NORMAL';
        this.bots.set(player.id, new BotBrain(player.id, team, diff, () => this.arena, new Rng(this.rng.int(1, 1e9))));
      }
    });

    const sim = this;
    const ctx: ModeContext = {
      config: this.config,
      get arena() {
        return sim.arena;
      },
      setArenaScale: (scale) => {
        this.arenaScale = scale;
        this.arena = scaleArena(this.baseArena, scale);
      },
      rng: this.rng,
      players: this.players,
      emit: (e) => this.events.push(e),
    };
    this.mode.initialize(ctx);
  }

  start(): void {
    this.mode.startRound();
  }

  get phase(): Phase {
    return this.mode.phase;
  }

  get finished(): boolean {
    return this.mode.isFinished();
  }

  /**
   * Queue an input from a human subject. Each queued input represents exactly one
   * simulation tick, so client prediction can replay unacknowledged inputs precisely.
   * Out-of-order / duplicate inputs are ignored; the queue is bounded so a client
   * cannot bank inputs to move faster than everyone else.
   */
  queueInput(id: string, input: PlayerInput): void {
    const p = this.players.get(id);
    if (!p || p.isBot) return;
    const queue = this.inputQueues.get(id) ?? [];
    const lastQueued = queue[queue.length - 1]?.seq ?? p.lastSeq;
    if (input.seq <= lastQueued) return;
    queue.push(input);
    if (queue.length > MAX_QUEUED_INPUTS) queue.splice(0, queue.length - MAX_QUEUED_INPUTS);
    this.inputQueues.set(id, queue);
  }

  tick(dt: number): void {
    this.time += dt;

    for (const p of this.players.values()) {
      if (p.isBot) continue;
      const next = this.inputQueues.get(p.id)?.shift();
      if (next) {
        p.input = next;
        p.lastSeq = next.seq;
      } else {
        // No input this tick (packet loss / idle): keep aim, stop moving.
        p.input = { ...p.input, moveX: 0, moveZ: 0, sprint: false };
      }
    }

    for (const [id, brain] of this.bots) {
      const p = this.players.get(id);
      if (!p) continue;
      p.input = brain.update(dt, this.buildView(id));
    }

    const canMove = this.mode.canMove();
    const canAim = this.mode.canAim();
    for (const p of this.players.values()) {
      p.moving = false;
      if (!p.alive || !p.inRound) continue;
      if (canAim) p.yaw = p.input.yaw;
      if (canMove) {
        const next = stepMovement(p.pos, p.input, dt, this.arena);
        p.moving = Math.hypot(next.x - p.pos.x, next.z - p.pos.z) > 1e-4;
        p.pos = next;
      }
    }

    this.mode.update(dt);
  }

  drainEvents(): MatchEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** The filtered view a given viewer is allowed to see. */
  buildView(viewerId: string): MatchView {
    const viewer = this.players.get(viewerId);
    return {
      viewerId,
      time: this.time,
      phase: this.mode.phase,
      phaseDuration: this.mode.phaseDuration,
      phaseRemaining: Math.max(0, this.mode.phaseDuration - this.mode.phaseElapsed),
      round: this.mode.round,
      shot: this.mode.shot,
      roster: [...this.players.values()].map(toPlayerInfo),
      bodies: visibleBodies(viewer, this.players.values(), this.mode.phase),
      teamWins: { ...this.mode.teamWins },
      config: this.config,
      arenaScale: this.arenaScale,
      ackSeq: viewer?.lastSeq ?? 0,
    };
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    if (!connected) {
      p.input = { ...p.input, moveX: 0, moveZ: 0, sprint: false };
      this.inputQueues.delete(id);
      if (p.alive) this.mode.onPlayerRemoved(id);
    }
  }

  setHost(id: string): void {
    for (const p of this.players.values()) p.isHost = p.id === id;
  }

  connectedHumans(): number {
    return [...this.players.values()].filter((p) => !p.isBot && p.connected).length;
  }

  private assignTeams(seeds: readonly PlayerSeed[]): { seed: PlayerSeed; team: TeamId }[] {
    if (this.config.mode !== 'TEAMS') return seeds.map((seed) => ({ seed, team: 0 }));
    const withTeams = seeds.map((seed, i) => ({ seed, team: (seed.team ? seed.team : (i % 2) + 1) as TeamId }));
    return withTeams;
  }
}
