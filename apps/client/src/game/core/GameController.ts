import * as THREE from 'three';
import {
  AIM_PHASES,
  HIDDEN_PHASES,
  MOVE_PHASES,
  MUZZLE_HEIGHT,
  SIM_TICK_RATE,
  SUBJECT_COLORS,
  TEAM_COLORS,
  angleDiff,
  dirToYaw,
  spawnPads,
  stepMovement,
  wrapAngle,
  type BodyState,
  type MatchEvent,
  type MatchView,
  type PlayerInfo,
  type PlayerInput,
  type RayTarget,
  type ShootoutEvent,
  type SpawnPad,
  type Vec2,
} from '@blindshot/shared';
import { audio } from '../audio/AudioEngine';
import { shade } from '../characters/materials';
import { SubjectView } from '../characters/SubjectView';
import { BlindShotPresenter } from '../modes/blindShot/BlindShotPresenter';
import type { GameSession } from '../../networking/GameSession';
import { hudStore, initialHud } from '../../state/hud';
import { settingsStore } from '../../state/settings';
import type { ClientWorld } from './ClientWorld';

const STEP = 1 / SIM_TICK_RATE;
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -MUZZLE_HEIGHT);
const v3 = new THREE.Vector3();
const ndc = new THREE.Vector2();

interface Scheduled {
  at: number;
  fn: () => void;
}

/**
 * Binds a GameSession (local or online) to the 3D world: creates subjects, interpolates
 * remote ones, predicts the local one, samples input, plays the shootout and feeds the HUD.
 */
export class GameController {
  private readonly views = new Map<string, SubjectView>();
  private readonly roster = new Map<string, PlayerInfo>();
  private readonly presenter: BlindShotPresenter;
  private readonly disposers: (() => void)[] = [];
  private view: MatchView | null = null;
  private viewReceivedAt = 0;
  private pads: SpawnPad[] = [];
  private padSignature = '';
  private clock = 0;
  private timeline: Scheduled[] = [];
  private paused = false;
  private dying = new Set<string>();
  private awaitingSpawn = new Set<string>();

  // Local prediction.
  private seq = 0;
  private pending: PlayerInput[] = [];
  private predicted: Vec2 = { x: 0, z: 0 };
  private prevPredicted: Vec2 = { x: 0, z: 0 };
  private error: Vec2 = { x: 0, z: 0 };
  private inputAcc = 0;
  private aimYaw = 0;
  private aimPoint: Vec2 | null = null;
  private localAlive = false;

  constructor(
    private readonly world: ClientWorld,
    private readonly session: GameSession,
    roomCode: string | null = null,
  ) {
    this.presenter = new BlindShotPresenter(world.chamber, (d, fn) => this.schedule(d, fn), session.localId);
    hudStore.set({ ...initialHud(), active: true, online: session.online, localId: session.localId, roomCode });
    world.cameraRig.mode = 'player';
    world.cameraTarget = () => ({
      subject: this.renderedLocal(),
      pad: this.localPad(),
      aim: this.aimPoint,
    });
    this.disposers.push(world.addUpdate((dt) => this.update(dt)));
    this.disposers.push(
      world.input.onPress((code) => {
        if (code === 'Tab') hudStore.set({ showScoreboard: true });
        if (code === 'Escape') this.togglePause();
      }),
      world.input.onRelease((code) => {
        if (code === 'Tab') hudStore.set({ showScoreboard: false });
      }),
    );
    const onCanvasClick = () => {
      if (settingsStore.get().aimMode === 'MOUSE_TURN' && !this.paused) world.input.requestPointerLock();
    };
    world.engine.canvas.addEventListener('click', onCanvasClick);
    this.disposers.push(() => world.engine.canvas.removeEventListener('click', onCanvasClick));
    session.setListener({ onView: (v) => this.onView(v), onEvent: (e) => this.onEvent(e) });
    audio.startAmbience();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.session.setPaused(paused && !this.session.online);
    this.world.input.setEnabled(!paused);
    if (paused) this.world.input.exitPointerLock();
    hudStore.set({ paused });
  }

  togglePause(): void {
    if (hudStore.get().matchResult) return;
    this.setPaused(!this.paused);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.session.dispose();
    this.world.input.exitPointerLock();
    this.world.input.setEnabled(true);
    this.world.cameraRig.mode = 'menu';
    this.world.cameraTarget = () => ({ subject: null, pad: null, aim: null });
    this.world.chamber.setPads([], []);
    this.world.chamber.setMood('menu');
    this.world.chamber.setDisplay('TEST CHAMBER 01', 'SUBJECTS STAND BY');
    this.world.effects.clearDecals();
    audio.setLaserHum(false);
    hudStore.set(initialHud());
  }

  // ---------------------------------------------------------------------------
  // Session callbacks

  private onView(view: MatchView): void {
    this.view = view;
    this.viewReceivedAt = performance.now() / 1000;
    this.roster.clear();
    for (const p of view.roster) this.roster.set(p.id, p);
    this.refreshPads(view);

    const present = new Set<string>();
    for (const body of view.bodies) {
      present.add(body.id);
      this.syncBody(body, view);
    }
    const hidden = HIDDEN_PHASES.has(view.phase);
    for (const [id, sv] of this.views) {
      if (present.has(id)) continue;
      if (hidden) sv.beginFade();
      else if (!sv.ragdoll) {
        sv.dispose();
        this.views.delete(id);
      }
    }

    // Local reconciliation: rewind to the authoritative position, replay unacknowledged inputs.
    const me = view.bodies.find((b) => b.id === this.session.localId);
    this.localAlive = !!me?.alive;
    if (me && me.alive && MOVE_PHASES.has(view.phase) && view.config.movement === 'LIGHT') {
      this.pending = this.pending.filter((i) => i.seq > view.ackSeq);
      const pad = this.localPad();
      let p: Vec2 = { ...me.pos };
      if (pad) for (const input of this.pending) p = stepMovement(p, input, STEP, pad, view.config.movement, this.world.arena);
      this.error.x += this.predicted.x - p.x;
      this.error.z += this.predicted.z - p.z;
      if (Math.hypot(this.error.x, this.error.z) > 1.5) this.error = { x: 0, z: 0 };
      this.prevPredicted = { x: this.prevPredicted.x - (this.predicted.x - p.x), z: this.prevPredicted.z - (this.predicted.z - p.z) };
      this.predicted = p;
    } else if (me) {
      this.pending = [];
      this.predicted = { ...me.pos };
      this.prevPredicted = { ...me.pos };
      this.error = { x: 0, z: 0 };
      if (!AIM_PHASES.has(view.phase)) this.aimYaw = me.yaw;
    }

    const local = this.roster.get(this.session.localId);
    const spectating = !!local && (!local.inRound || !local.alive) && view.phase !== 'ROUND_INTRO' && view.phase !== 'SPAWN';
    if (spectating !== hudStore.get().spectating && !this.dying.has(this.session.localId)) {
      hudStore.set({ spectating });
      this.world.cameraRig.mode = spectating ? 'spectate' : 'player';
    }
    hudStore.set({
      phase: view.phase,
      round: view.round,
      shot: view.shot,
      phaseDuration: view.phaseDuration,
      roster: view.roster,
      teamWins: view.teamWins,
      config: view.config,
    });
  }

  private onEvent(e: MatchEvent): void {
    switch (e.type) {
      case 'phaseChanged':
        if (e.data.phase === 'ROUND_INTRO') this.resetForRound();
        if (e.data.phase === 'SPAWN') this.dropInSubjects();
        if (e.data.phase === 'VISIBLE' && e.data.round === 1 && e.data.shot === 1) {
          hudStore.set({ hintsVisible: true });
          this.schedule(8, () => hudStore.set({ hintsVisible: false }));
        }
        this.presenter.onPhase(e.data, [...this.roster.values()]);
        break;
      case 'shootout':
        this.presenter.onShootout(e.data);
        this.playShootout(e.data);
        break;
      case 'roundEnded': {
        hudStore.set({ roundResult: e.data, roster: e.data.roster });
        const won = e.data.winnerIds.includes(this.session.localId);
        if (won) audio.victory();
        else if (!e.data.draw) audio.defeat();
        break;
      }
      case 'matchEnded':
        hudStore.set({ matchResult: e.data, roster: e.data.roster });
        this.world.input.exitPointerLock();
        if (e.data.winnerIds.includes(this.session.localId)) this.schedule(0.2, () => audio.victory());
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Frame update

  private update(dt: number): void {
    this.clock += dt;
    this.runTimeline();
    this.session.update(dt);
    const view = this.view;
    if (!view) return;

    const now = performance.now() / 1000;
    const sincePacket = this.paused && !this.session.online ? 0 : now - this.viewReceivedAt;
    const timeLeft = Math.max(0, view.phaseRemaining - sincePacket);
    this.presenter.tick(dt, view.phase, timeLeft);
    const rounded = Math.round(timeLeft * 10) / 10;
    if (rounded !== hudStore.get().timeLeft) hudStore.set({ timeLeft: rounded });

    this.sampleLocalInput(dt, view);

    const renderTime = view.time + sincePacket - this.session.interpolationDelay;
    const localId = this.session.localId;
    const k = Math.exp(-12 * dt);
    this.error.x *= k;
    this.error.z *= k;

    // Pose every subject.
    for (const sv of this.views.values()) {
      if (sv.ragdoll) continue;
      if (sv.id === localId && this.localAlive && AIM_PHASES.has(view.phase)) {
        const r = this.renderedLocal();
        if (r) sv.setPose(r, this.aimYaw, this.pending.length > 0 && this.isMovingInput());
      } else {
        sv.sample(renderTime);
      }
    }

    // Laser + subject updates.
    const targets: RayTarget[] = [];
    for (const sv of this.views.values()) {
      if (sv.ragdoll || sv.presence !== 'visible' || sv.ghost) continue;
      if (!this.roster.get(sv.id)?.alive) continue;
      targets.push({ id: sv.id, pos: sv.pos });
    }
    const hidden = HIDDEN_PHASES.has(view.phase);
    for (const sv of this.views.values()) {
      const alive = this.roster.get(sv.id)?.alive ?? false;
      let laser = 0;
      if (alive && !sv.ragdoll && sv.presence === 'visible') {
        if (view.phase === 'VISIBLE') laser = sv.ghost ? 0.3 : 1;
        else if (hidden) laser = sv.id === localId ? 1 : sv.ghost ? 0.3 : 0;
      }
      sv.laser.setActive(laser > 0, laser);
      sv.tag.visible = !sv.ragdoll && sv.presence === 'visible' && (sv.id !== localId || view.phase === 'SPAWN' || view.phase === 'ROUND_INTRO');
      const aiming = view.phase !== 'ROUND_INTRO';
      sv.update(dt, this.world.arena, targets.filter((t) => t.id !== sv.id), aiming);
    }
  }

  private sampleLocalInput(dt: number, view: MatchView): void {
    const settings = settingsStore.get();
    const canAim = this.localAlive && AIM_PHASES.has(view.phase) && !this.paused;
    const canMove = canAim && view.config.movement === 'LIGHT';
    const input = this.world.input;
    const me = this.renderedLocal();

    if (canAim && me) {
      if (settings.aimMode === 'MOUSE_TURN') {
        this.aimYaw = wrapAngle(this.aimYaw - input.consumeTurn() * 0.0025 * settings.mouseSensitivity);
        const d = { x: Math.sin(this.aimYaw), z: Math.cos(this.aimYaw) };
        this.aimPoint = { x: me.x + d.x * 6, z: me.z + d.z * 6 };
      } else {
        ndc.set(input.state.pointerX, input.state.pointerY);
        raycaster.setFromCamera(ndc, this.world.engine.camera);
        const hit = raycaster.ray.intersectPlane(aimPlane, v3);
        if (hit) {
          this.aimPoint = { x: hit.x, z: hit.z };
          const dx = hit.x - me.x;
          const dz = hit.z - me.z;
          if (Math.hypot(dx, dz) > 0.6) {
            const target = dirToYaw({ x: dx, z: dz });
            // Very light smoothing: responsive but not twitchy.
            this.aimYaw = wrapAngle(this.aimYaw + angleDiff(this.aimYaw, target) * (1 - Math.exp(-35 * dt)));
          }
        }
      }
    } else {
      input.consumeTurn();
    }

    this.inputAcc += dt;
    while (this.inputAcc >= STEP) {
      this.inputAcc -= STEP;
      if (!canAim) continue;
      const move = canMove ? this.cameraRelativeMove() : { x: 0, z: 0 };
      const cmd: PlayerInput = {
        seq: ++this.seq,
        moveX: move.x,
        moveZ: move.z,
        sprint: input.state.sprint,
        yaw: this.aimYaw,
      };
      if (canMove) {
        const pad = this.localPad();
        this.prevPredicted = { ...this.predicted };
        if (pad) this.predicted = stepMovement(this.predicted, cmd, STEP, pad, view.config.movement, this.world.arena);
        this.pending.push(cmd);
        if (this.pending.length > 90) this.pending.shift();
      }
      this.session.sendInput(cmd);
    }
  }

  // ---------------------------------------------------------------------------
  // Shootout

  private playShootout(e: ShootoutEvent): void {
    const localId = this.session.localId;
    // Reveal: everyone who was alive is shown at their true position, right now.
    for (const body of e.revealed) {
      const sv = this.ensureView(body.id);
      if (!sv) continue;
      sv.reveal();
      sv.setGhost(false);
      sv.snap(body.pos, body.yaw, this.view?.time);
      if (body.id === localId) {
        this.predicted = { ...body.pos };
        this.prevPredicted = { ...body.pos };
        this.aimYaw = body.yaw;
        this.pending = [];
      }
    }

    const fx = this.world.effects;
    const cam = this.world.engine.camera;
    this.world.chamber.flash(1);
    fx.shake(0.6);
    hudStore.set({ flashId: hudStore.get().flashId + 1 });
    audio.gunshot(0, 4, 0, 1.15);

    for (const shot of e.shots) {
      const sv = this.views.get(shot.shooterId);
      sv?.model.fire();
      const origin = new THREE.Vector3(shot.origin.x, MUZZLE_HEIGHT, shot.origin.z);
      const dir = new THREE.Vector3(shot.dir.x, 0, shot.dir.z);
      const end = new THREE.Vector3(shot.end.x, MUZZLE_HEIGHT, shot.end.z);
      fx.muzzleFlash(origin, dir);
      fx.tracer(origin, end);
      const pan = this.panFor(origin, cam);
      audio.gunshot(pan, origin.distanceTo(cam.position), 0.006 + Math.random() * 0.03, 0.55);
      if (shot.hitSurface === 'WALL' || shot.hitSurface === 'PILLAR') {
        const normal =
          shot.hitSurface === 'WALL'
            ? new THREE.Vector3(-shot.end.x, 0, -shot.end.z).normalize()
            : this.pillarNormal(shot.end);
        this.schedule(0.04, () => {
          fx.wallImpact(end, normal);
          audio.metalImpact(this.panFor(end, cam));
        });
      }
    }

    // Hits land a beat after the flash, then bodies fly.
    const impulses = new Map<string, THREE.Vector3>();
    for (const shot of e.shots) {
      if (!shot.hitPlayerId) continue;
      const acc = impulses.get(shot.hitPlayerId) ?? new THREE.Vector3();
      acc.add(new THREE.Vector3(shot.dir.x, 0, shot.dir.z));
      impulses.set(shot.hitPlayerId, acc);
    }
    for (const id of e.eliminated) this.dying.add(id);
    this.schedule(0.07, () => {
      for (const id of e.eliminated) {
        const sv = this.views.get(id);
        const info = this.roster.get(id);
        if (!sv) continue;
        const dir = impulses.get(id) ?? new THREE.Vector3(0, 0, 1);
        const strength = Math.min(1.8, 0.9 + dir.length() * 0.3);
        sv.model.flashHit();
        fx.subjectHit(new THREE.Vector3(sv.pos.x, 1.3, sv.pos.z), dir.clone().normalize(), info ? this.bodyColor(info) : '#ffffff');
        audio.bodyHit(this.panFor(new THREE.Vector3(sv.pos.x, 1, sv.pos.z), cam));
        this.schedule(0.05, () => sv.kill(this.world.physics, dir.normalize(), strength));
      }
      if (e.eliminated.length > 0) fx.shake(0.35);
    });
    if (e.eliminated.includes(localId)) {
      this.schedule(1.4, () => {
        this.dying.delete(localId);
        hudStore.set({ spectating: true });
        this.world.cameraRig.mode = 'spectate';
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers

  private syncBody(body: BodyState, view: MatchView): void {
    const info = this.roster.get(body.id);
    if (!info) return;
    let sv = this.views.get(body.id);
    if (sv && sv.ragdoll && body.alive) {
      // Respawn after a ragdoll death.
      sv.dispose();
      this.views.delete(body.id);
      sv = undefined;
    }
    if (!sv) {
      if (!body.alive) return;
      sv = this.ensureView(body.id) ?? undefined;
      if (!sv) return;
      sv.snap(body.pos, body.yaw, view.time);
      if (view.phase === 'ROUND_INTRO') {
        sv.hideNow();
        this.awaitingSpawn.add(body.id);
      }
      if (body.id === this.session.localId) this.aimYaw = body.yaw;
    }
    if (!body.alive && !sv.ragdoll && !this.dying.has(body.id)) {
      sv.hideNow();
      return;
    }
    if (sv.presence !== 'visible' && body.alive && !this.awaitingSpawn.has(body.id)) {
      sv.reveal();
      sv.snap(body.pos, body.yaw, view.time);
    }
    sv.setGhost(body.visibility === 'ghost');
    sv.push(view.time, body.pos, body.yaw, body.moving);
  }

  private ensureView(id: string): SubjectView | null {
    const existing = this.views.get(id);
    if (existing) return existing;
    const info = this.roster.get(id);
    if (!info) return null;
    const isLocal = id === this.session.localId;
    const label = isLocal ? 'YOU' : `${String(info.subject).padStart(2, '0')} ${info.name.toUpperCase()}`;
    const sv = new SubjectView(
      id,
      { bodyColor: this.bodyColor(info), accentColor: SUBJECT_COLORS[info.colorIndex] ?? '#e3b23c', subject: info.subject },
      label,
      this.laserColor(info),
      this.world.engine.scene,
      isLocal,
    );
    this.views.set(id, sv);
    return sv;
  }

  private resetForRound(): void {
    for (const sv of this.views.values()) sv.dispose();
    this.views.clear();
    this.dying.clear();
    this.awaitingSpawn.clear();
    this.world.effects.clearDecals();
    hudStore.set({ spectating: false });
    this.world.cameraRig.mode = 'player';
  }

  private dropInSubjects(): void {
    let i = 0;
    for (const id of this.awaitingSpawn) {
      const delay = i++ * 0.07;
      this.schedule(delay, () => {
        const sv = this.views.get(id);
        if (!sv) return;
        sv.reveal();
        sv.model.spawnDrop();
        this.awaitingSpawn.delete(id);
        this.schedule(0.3, () => audio.thud());
      });
    }
  }

  private refreshPads(view: MatchView): void {
    const signature = `${view.roster.length}:${view.config.mode}`;
    if (signature === this.padSignature) return;
    this.padSignature = signature;
    this.pads = spawnPads(this.world.arena, view.roster.length);
    const colors: string[] = [];
    for (const p of view.roster) colors[p.padIndex] = this.bodyColor(p);
    this.world.chamber.setPads(this.pads, colors);
  }

  private localPad(): Vec2 | null {
    const info = this.roster.get(this.session.localId);
    if (!info) return null;
    return this.pads[info.padIndex]?.pos ?? null;
  }

  private renderedLocal(): Vec2 | null {
    if (!this.view) return null;
    const t = Math.min(1, this.inputAcc / STEP);
    return {
      x: this.prevPredicted.x + (this.predicted.x - this.prevPredicted.x) * t + this.error.x,
      z: this.prevPredicted.z + (this.predicted.z - this.prevPredicted.z) * t + this.error.z,
    };
  }

  private isMovingInput(): boolean {
    const s = this.world.input.state;
    return s.moveX !== 0 || s.moveY !== 0;
  }

  private cameraRelativeMove(): Vec2 {
    const s = this.world.input.state;
    if (s.moveX === 0 && s.moveY === 0) return { x: 0, z: 0 };
    const cam = this.world.engine.camera;
    cam.getWorldDirection(v3);
    const f = { x: v3.x, z: v3.z };
    const fl = Math.hypot(f.x, f.z) || 1;
    f.x /= fl;
    f.z /= fl;
    const r = { x: -f.z, z: f.x };
    const x = f.x * s.moveY + r.x * s.moveX;
    const z = f.z * s.moveY + r.z * s.moveX;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  }

  private bodyColor(info: PlayerInfo): string {
    if (this.view?.config.mode === 'TEAMS' && info.team !== 0) return TEAM_COLORS[info.team];
    return SUBJECT_COLORS[info.colorIndex] ?? '#e3b23c';
  }

  private laserColor(info: PlayerInfo): string {
    const settings = settingsStore.get();
    const local = this.roster.get(this.session.localId);
    if (settings.laserPalette === 'HIGH_CONTRAST') {
      if (info.id === this.session.localId) return '#00e5ff';
      if (local && local.team !== 0 && local.team === info.team) return '#7dff6a';
      return '#ff2bd6';
    }
    return `#${shade(this.bodyColor(info), 0.12).getHexString()}`;
  }

  private panFor(p: THREE.Vector3, cam: THREE.Camera): number {
    v3.copy(p).applyMatrix4(cam.matrixWorldInverse);
    return Math.max(-1, Math.min(1, v3.x / 9));
  }

  private pillarNormal(end: Vec2): THREE.Vector3 {
    let best = this.world.arena.pillars[0];
    let bestD = Infinity;
    for (const p of this.world.arena.pillars) {
      const d = Math.hypot(end.x - p.pos.x, end.z - p.pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3(end.x - best.pos.x, 0, end.z - best.pos.z).normalize();
  }

  private schedule(delay: number, fn: () => void): void {
    this.timeline.push({ at: this.clock + delay, fn });
  }

  private runTimeline(): void {
    if (this.timeline.length === 0) return;
    const due = this.timeline.filter((s) => s.at <= this.clock);
    if (due.length === 0) return;
    this.timeline = this.timeline.filter((s) => s.at > this.clock);
    for (const s of due) s.fn();
  }
}
