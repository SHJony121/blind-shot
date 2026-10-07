import { castRay, resolveCollisions, type ArenaDef } from '../arena/arena';
import { PLAYER_HIT_RADIUS } from '../constants/game';
import {
  angleDiff,
  distance,
  dirToYaw,
  normalize,
  sub,
  turnToward,
  yawToDir,
  type Vec2,
} from '../math/vec';
import type { Rng } from '../util/rng';
import type { BodyState, BotDifficulty, MatchView, PlayerInput, TeamId } from '../types';

interface BotProfile {
  reaction: [number, number];
  /** Std-dev (m) of the error added to a remembered position. */
  memoryNoise: number;
  /** Std-dev (deg) of the per-shot aim error. */
  aimErrorDeg: number;
  /** Small per-tick wobble (deg). */
  jitterDeg: number;
  wrongTargetChance: number;
  /** 0 = aims at last seen spot; 1 = extrapolates the full observed velocity. */
  predictFactor: number;
  /** Chance of guessing that the target will dodge sideways. */
  dodgeGuessChance: number;
  /** Chance of repositioning while hidden (higher when someone aims at the bot). */
  dodgeChance: number;
  /** rad/s */
  turnSpeed: number;
}

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  EASY: {
    reaction: [0.6, 1.1],
    memoryNoise: 0.6,
    aimErrorDeg: 3,
    jitterDeg: 1.2,
    wrongTargetChance: 0.3,
    predictFactor: 0,
    dodgeGuessChance: 0,
    dodgeChance: 0.1,
    turnSpeed: 2.2,
  },
  NORMAL: {
    reaction: [0.3, 0.6],
    memoryNoise: 0.25,
    aimErrorDeg: 1.4,
    jitterDeg: 0.5,
    wrongTargetChance: 0.1,
    predictFactor: 0.5,
    dodgeGuessChance: 0.08,
    dodgeChance: 0.2,
    turnSpeed: 3.6,
  },
  HARD: {
    reaction: [0.15, 0.3],
    memoryNoise: 0.1,
    aimErrorDeg: 0.7,
    jitterDeg: 0.25,
    wrongTargetChance: 0.03,
    predictFactor: 1,
    dodgeGuessChance: 0.12,
    dodgeChance: 0.3,
    turnSpeed: 5,
  },
};

interface Memory {
  pos: Vec2;
  vel: Vec2;
  yaw: number;
  seenAt: number;
}

/**
 * A bot that only knows what its own filtered MatchView tells it — exactly what a human
 * in its seat would see. Hidden subjects are absent from the view, so the bot must rely
 * on its memory, which is deliberately imperfect.
 */
export class BotBrain {
  private readonly profile: BotProfile;
  private readonly memory = new Map<string, Memory>();
  private shotKey = '';
  private reactionLeft = 0;
  private targetId: string | null = null;
  private aimOffset = 0;
  private retargeted = false;
  private predicted: Vec2 | null = null;
  private moveGoal: Vec2;
  private yaw = 0;
  private seq = 0;
  private wasHidden = false;

  constructor(
    private readonly selfId: string,
    private readonly team: TeamId,
    difficulty: BotDifficulty,
    private readonly arenaOf: () => ArenaDef,
    private readonly rng: Rng,
  ) {
    this.profile = BOT_PROFILES[difficulty];
    this.moveGoal = { x: 0, z: 0 };
  }

  update(dt: number, view: MatchView): PlayerInput {
    const me = view.bodies.find((b) => b.id === this.selfId);
    if (!me || !me.alive) return this.idle();

    const key = `${view.round}:${view.shot}`;
    if (key !== this.shotKey && view.phase === 'VISIBLE') this.beginShot(key, me);

    const enemies = view.bodies.filter((b) => b.alive && this.isEnemy(b.id, view) && b.visibility === 'full');
    for (const e of enemies) this.observe(e, view.time);

    const hidden = view.phase === 'HIDE' || view.phase === 'COUNTDOWN';
    if (hidden && !this.wasHidden) this.onTargetsHidden(me, view);
    this.wasHidden = hidden;

    if (view.phase === 'VISIBLE') this.thinkVisible(dt, me, enemies, view);

    let aimPoint: Vec2 | null = null;
    if (hidden) {
      aimPoint = this.predicted;
    } else if (this.targetId && this.reactionLeft <= 0) {
      aimPoint = enemies.find((e) => e.id === this.targetId)?.pos ?? null;
    }
    if (aimPoint) {
      const jitter = ((this.rng.gaussian() * this.profile.jitterDeg) * Math.PI) / 180;
      const desired = dirToYaw(sub(aimPoint, me.pos)) + this.aimOffset + jitter * 0.3;
      this.yaw = turnToward(this.yaw, desired, this.profile.turnSpeed * dt);
    }

    const toGoal = sub(this.moveGoal, me.pos);
    const far = Math.hypot(toGoal.x, toGoal.z) > 0.15;
    const move = far ? normalize(toGoal) : { x: 0, z: 0 };
    this.seq += 1;
    return { seq: this.seq, moveX: move.x, moveZ: move.z, sprint: hidden && far, yaw: this.yaw };
  }

  // ---------------------------------------------------------------------------

  private idle(): PlayerInput {
    this.seq += 1;
    return { seq: this.seq, moveX: 0, moveZ: 0, sprint: false, yaw: this.yaw };
  }

  private beginShot(key: string, me: BodyState): void {
    this.shotKey = key;
    this.yaw = me.yaw;
    this.reactionLeft = this.rng.range(this.profile.reaction[0], this.profile.reaction[1]);
    this.targetId = null;
    this.retargeted = false;
    this.predicted = null;
    this.aimOffset = (this.rng.gaussian() * this.profile.aimErrorDeg * Math.PI) / 180;
    this.wasHidden = false;
    // Wander a little while visible so bots don't look like statues.
    this.moveGoal = this.randomPointNear(me.pos, 2.2);
  }

  private observe(e: BodyState, time: number): void {
    const prev = this.memory.get(e.id);
    let vel = { x: 0, z: 0 };
    if (prev && time > prev.seenAt) {
      const dt = time - prev.seenAt;
      const raw = { x: (e.pos.x - prev.pos.x) / dt, z: (e.pos.z - prev.pos.z) / dt };
      // Smoothed velocity estimate.
      vel = { x: prev.vel.x * 0.7 + raw.x * 0.3, z: prev.vel.z * 0.7 + raw.z * 0.3 };
    }
    this.memory.set(e.id, { pos: { ...e.pos }, vel, yaw: e.yaw, seenAt: time });
  }

  private thinkVisible(dt: number, me: BodyState, enemies: BodyState[], view: MatchView): void {
    if (this.reactionLeft > 0) {
      this.reactionLeft -= dt;
      if (this.reactionLeft <= 0) this.targetId = this.chooseTarget(me, enemies);
      return;
    }
    if (this.targetId && !enemies.some((e) => e.id === this.targetId)) this.targetId = this.chooseTarget(me, enemies);
    // Late in the visible phase, smarter bots may switch to whoever is aiming at them.
    const progress = view.phaseDuration > 0 ? 1 - view.phaseRemaining / view.phaseDuration : 1;
    if (!this.retargeted && progress > 0.65) {
      this.retargeted = true;
      const threat = enemies.find((e) => this.isAimingAt(e, me.pos));
      if (threat && threat.id !== this.targetId && this.rng.chance(1 - this.profile.wrongTargetChance * 2)) {
        if (this.rng.chance(0.5)) this.targetId = threat.id;
      }
    }
  }

  private chooseTarget(me: BodyState, enemies: BodyState[]): string | null {
    if (enemies.length === 0) return null;
    if (this.rng.chance(this.profile.wrongTargetChance)) return this.rng.pick(enemies)?.id ?? null;
    const weights = enemies.map((e) => {
      let w = 1 + 4 / Math.max(1, distance(me.pos, e.pos));
      if (this.isAimingAt(e, me.pos)) w += 2;
      if (this.lineBlocked(me.pos, e.pos)) w *= 0.15;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.rng.next() * total;
    for (let i = 0; i < enemies.length; i++) {
      r -= weights[i] ?? 0;
      if (r <= 0) return enemies[i]?.id ?? null;
    }
    return enemies[enemies.length - 1]?.id ?? null;
  }

  private onTargetsHidden(me: BodyState, view: MatchView): void {
    // Commit to where the target probably is.
    if (!this.targetId) {
      const remembered = [...this.memory.entries()].filter(([id]) => this.isEnemy(id, view));
      this.targetId = this.rng.pick(remembered)?.[0] ?? null;
    }
    const mem = this.targetId ? this.memory.get(this.targetId) : undefined;
    if (mem) {
      // Extrapolate a little of the observed motion (people rarely keep running in a line).
      const lookAhead = 0.6 * this.profile.predictFactor;
      const drift = { x: mem.vel.x * lookAhead, z: mem.vel.z * lookAhead };
      const dl = Math.hypot(drift.x, drift.z);
      if (dl > 2) {
        drift.x *= 2 / dl;
        drift.z *= 2 / dl;
      }
      let guess: Vec2 = {
        x: mem.pos.x + drift.x + this.rng.gaussian() * this.profile.memoryNoise,
        z: mem.pos.z + drift.z + this.rng.gaussian() * this.profile.memoryNoise,
      };
      if (this.rng.chance(this.profile.dodgeGuessChance)) {
        // Guess the target sidesteps: offset perpendicular to our line of fire.
        const line = normalize(sub(mem.pos, me.pos));
        const side = this.rng.chance(0.5) ? 1 : -1;
        guess = { x: guess.x - line.z * side * 1.6, z: guess.z + line.x * side * 1.6 };
      }
      this.predicted = guess;
    }

    // Decide whether to reposition while nobody can see us.
    const threatened = [...this.memory.entries()].some(
      ([id, m]) => this.isEnemy(id, view) && this.isAimingAtFrom(m.pos, m.yaw, me.pos),
    );
    const chance = this.profile.dodgeChance * (threatened ? 1.8 : 0.6);
    this.moveGoal = this.rng.chance(chance) ? this.randomPointNear(me.pos, 3) : { ...me.pos };
  }

  private isEnemy(id: string, view: MatchView): boolean {
    if (id === this.selfId) return false;
    if (this.team === 0) return true;
    return view.roster.find((p) => p.id === id)?.team !== this.team;
  }

  private isAimingAt(e: BodyState, target: Vec2): boolean {
    return this.isAimingAtFrom(e.pos, e.yaw, target);
  }

  private isAimingAtFrom(from: Vec2, yaw: number, target: Vec2): boolean {
    const want = dirToYaw(sub(target, from));
    const tolerance = Math.atan2(PLAYER_HIT_RADIUS * 1.6, Math.max(0.5, distance(from, target)));
    return Math.abs(angleDiff(yaw, want)) < tolerance;
  }

  private lineBlocked(from: Vec2, to: Vec2): boolean {
    const dir = normalize(sub(to, from));
    return castRay(this.arenaOf(), from, dir, []).distance < distance(from, to);
  }

  private randomPointNear(from: Vec2, radius: number): Vec2 {
    const a = this.rng.range(0, Math.PI * 2);
    const r = (0.4 + 0.6 * Math.sqrt(this.rng.next())) * radius;
    const d = yawToDir(a);
    return resolveCollisions(this.arenaOf(), { x: from.x + d.x * r, z: from.z + d.z * r }, PLAYER_HIT_RADIUS * 2);
  }
}
