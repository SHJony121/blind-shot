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
  stepMovement,
  wrapAngle,
  type BodyState,
  type MatchEvent,
  type MatchView,
  type PlayerInfo,
  type PlayerInput,
  type RayTarget,
  type ShotFiredEvent,
  type Vec2,
} from '@blindshot/shared';
import { audio } from '../audio/AudioEngine';
import { shade } from '../characters/materials';
import { SubjectView } from '../characters/SubjectView';
import { BlindShotPresenter } from '../modes/blindShot/BlindShotPresenter';
import type { GameSession } from '../../networking/GameSession';
import { hudStore, initialHud, showBanner } from '../../state/hud';
import { settingsStore } from '../../state/settings';
import type { ClientWorld } from './ClientWorld';

const STEP = 1 / SIM_TICK_RATE;
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -MUZZLE_HEIGHT);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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
  /** Subjects that already fired in the current volley (their laser switches off). */
  private fired = new Set<string>();
  private lastArenaScale = 0;
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
    this.presenter = new BlindShotPresenter(() => world.chamber, (d, fn) => this.schedule(d, fn), session.localId);
    hudStore.set({ ...initialHud(), active: true, online: session.online, localId: session.localId, roomCode });
    world.cameraRig.mode = 'player';
    world.cameraTarget = () => ({
      subject: this.view ? this.renderedLocal() : null,
      aim: this.aimPoint,
    });
    this.disposers.push(world.addUpdate((dt) => this.update(dt)));
    this.disposers.push(
      world.input.onPress((code) => {
        if (code === 'Tab') hudStore.set({ showScoreboard: true });
        if (code === 'Escape') this.togglePause();
        if (code === 'KeyC') Object.assign(this.world.cameraRig.inspect, { zoom: 1, yaw: 0, pitch: 0, focus: null });
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
    Object.assign(this.world.cameraRig.inspect, { enabled: false, zoom: 1, yaw: 0, pitch: 0, focus: null });
    this.world.input.leftDragOrbits = false;
    this.world.cameraTarget = () => ({ subject: null, aim: null });
    this.world.setArena('WHITE_ROOM');
    this.world.chamber.setMood('menu');
    this.world.chamber.setDisplay('WHITE ROOM', 'SUBJECTS STAND BY');
    this.world.effects.clearDecals();
    hudStore.set(initialHud());
  }

  // ---------------------------------------------------------------------------
  // Session callbacks

  private onView(view: MatchView): void {
    this.view = view;
    this.viewReceivedAt = performance.now() / 1000;
    this.roster.clear();
    for (const p of view.roster) this.roster.set(p.id, p);
    // Build the right arena. It shrinks after every volley; the edge slides in on screen.
    if (this.views.size === 0 && this.lastArenaScale === 0) this.world.chamber.setMood('normal');
    if (this.lastArenaScale !== 0 && view.arenaScale < this.lastArenaScale - 1e-6) {
      showBanner('ARENA SHRINKING', { size: 'md', tone: 'danger' });
      audio.whoosh();
    }
    this.lastArenaScale = view.arenaScale;
    this.world.setArena(view.config.mapId, view.arenaScale);

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
    if (me && me.alive && MOVE_PHASES.has(view.phase)) {
      this.pending = this.pending.filter((i) => i.seq > view.ackSeq);
      let p: Vec2 = { ...me.pos };
      for (const input of this.pending) p = stepMovement(p, input, STEP, this.world.arena);
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
    // Not in the roster at all = joined mid-match as a spectator.
    const spectating = !local || ((!local.inRound || !local.alive) && view.phase !== 'ROUND_INTRO' && view.phase !== 'SPAWN');
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
        if (e.data.phase === 'FREEZE' || e.data.phase === 'VISIBLE') this.fired.clear();
        if (e.data.phase === 'FREEZE') this.revealAll();
        if (e.data.phase === 'SPAWN') this.dropInSubjects();
        if (e.data.phase === 'VISIBLE' && e.data.round === 1 && e.data.shot === 1) {
          hudStore.set({ hintsVisible: true });
          this.schedule(8, () => hudStore.set({ hintsVisible: false }));
        }
        this.presenter.onPhase(e.data, [...this.roster.values()]);
        break;
      case 'shotFired':
        this.presenter.onShot(e.data);
        this.playShot(e.data);
        break;
      case 'playerFell':
        this.playFall(e.data.id, e.data.pos);
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
    this.updateInspect(view);

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
        if (view.phase === 'VISIBLE' || view.phase === 'FREEZE') laser = sv.ghost ? 0.3 : 1;
        else if (view.phase === 'SHOOTING') laser = this.fired.has(sv.id) ? 0 : 1;
        else if (hidden) laser = sv.id === localId ? 1 : sv.ghost ? 0.3 : 0;
      }
      sv.laser.setActive(laser > 0, laser);
      sv.tag.visible = !sv.ragdoll && sv.presence === 'visible' && (sv.id !== localId || view.phase === 'SPAWN' || view.phase === 'ROUND_INTRO');
      const aiming = view.phase !== 'ROUND_INTRO';
      sv.update(dt, this.world.arena, targets.filter((t) => t.id !== sv.id), aiming);
    }
  }

  /** Free camera at any time: scroll to zoom toward the cursor, right-drag to orbit (left-drag too when aims are locked). */
  private updateInspect(view: MatchView): void {
    const rig = this.world.cameraRig;
    const cam = this.world.input.consumeCamera();
    this.world.input.leftDragOrbits = !this.localAlive || !AIM_PHASES.has(view.phase);
    if (this.paused) return;
    rig.inspect.enabled = true;
    if (cam.wheel !== 0) {
      rig.inspect.zoom = Math.max(0.2, Math.min(2.2, rig.inspect.zoom * Math.pow(1.15, cam.wheel)));
      if (cam.wheel < 0) {
        ndc.set(this.world.input.state.pointerX, this.world.input.state.pointerY);
        raycaster.setFromCamera(ndc, this.world.engine.camera);
        const hit = raycaster.ray.intersectPlane(groundPlane, v3);
        if (hit) rig.inspect.focus = { x: hit.x, z: hit.z };
      }
    }
    rig.inspect.yaw -= cam.dragX * 0.006;
    rig.inspect.pitch = Math.max(-1.4, Math.min(0.7, rig.inspect.pitch + cam.dragY * 0.004));
  }

  private sampleLocalInput(dt: number, view: MatchView): void {
    const settings = settingsStore.get();
    const canAim = this.localAlive && AIM_PHASES.has(view.phase) && !this.paused;
    const canMove = canAim;
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
        this.prevPredicted = { ...this.predicted };
        this.predicted = stepMovement(this.predicted, cmd, STEP, this.world.arena);
        this.pending.push(cmd);
        if (this.pending.length > 90) this.pending.shift();
      }
      this.session.sendInput(cmd);
    }
  }

  // ---------------------------------------------------------------------------
  // Shootout

  /** Someone walked off a floating platform. Only shown when their position is public. */
  private playFall(id: string, pos: Vec2 | null): void {
    const localId = this.session.localId;
    const sv = this.views.get(id);
    const info = this.roster.get(id);
    const who = id === localId ? 'YOU' : info ? `SUBJECT ${String(info.subject).padStart(2, '0')}` : 'A SUBJECT';
    showBanner(`${who} FELL`, { size: 'md', tone: 'danger' });
    audio.whoosh();
    if (sv && pos && sv.presence === 'visible' && !sv.ragdoll) {
      this.dying.add(id);
      const out = new THREE.Vector3(pos.x, 0, pos.z).normalize();
      sv.kill(this.world.physics, out, 0.6);
    }
    if (id === localId) {
      this.schedule(1.2, () => {
        this.dying.delete(localId);
        hudStore.set({ spectating: true });
        this.world.cameraRig.mode = 'spectate';
      });
    }
  }

  /** FREEZE: everyone is shown where they really are, frozen, with their locked aim. */
  private revealAll(): void {
    // Hidden subjects re-appear (snapped to their true spot) when the next snapshot lists them.
    for (const sv of this.views.values()) if (sv.presence === 'fading') sv.hideNow();
    this.world.chamber.flash(0.6);
    audio.reveal();
  }

  /** One bullet. In SEQUENTIAL order these arrive one at a time, so every shot gets its moment. */
  private playShot(e: ShotFiredEvent): void {
    const shot = e.result;
    const localId = this.session.localId;
    const fx = this.world.effects;
    const cam = this.world.engine.camera;
    this.fired.add(shot.shooterId);

    const sv = this.views.get(shot.shooterId);
    sv?.model.fire();
    const origin = new THREE.Vector3(shot.origin.x, MUZZLE_HEIGHT, shot.origin.z);
    const dir = new THREE.Vector3(shot.dir.x, 0, shot.dir.z);
    const end = new THREE.Vector3(shot.end.x, MUZZLE_HEIGHT, shot.end.z);
    fx.muzzleFlash(origin, dir);
    fx.tracer(origin, end);
    this.world.chamber.flash(e.simultaneous ? 1 : 0.7);
    // One big bang per volley in SIMULTANEOUS order, a full shot each in SEQUENTIAL order.
    if (!e.simultaneous || e.index === 0) {
      fx.shake(e.simultaneous ? 0.6 : 0.42);
      hudStore.set({ flashId: hudStore.get().flashId + 1 });
      audio.gunshot(this.panFor(origin, cam), origin.distanceTo(cam.position), 0, e.simultaneous ? 1.2 : 1);
    } else {
      audio.gunshot(this.panFor(origin, cam), origin.distanceTo(cam.position), 0.006 + Math.random() * 0.03, 0.5);
    }

    if (shot.hitSurface === 'WALL' || shot.hitSurface === 'PILLAR') {
      const normal = new THREE.Vector3(shot.normal.x, 0, shot.normal.z);
      this.schedule(0.04, () => {
        fx.wallImpact(end, normal);
        audio.metalImpact(this.panFor(end, cam));
      });
    }

    for (const id of e.eliminated) {
      this.dying.add(id);
      const victim = this.views.get(id);
      const info = this.roster.get(id);
      if (!victim) continue;
      this.schedule(0.06, () => {
        victim.model.flashHit();
        fx.subjectHit(new THREE.Vector3(victim.pos.x, 1.3, victim.pos.z), dir.clone(), info ? this.bodyColor(info) : '#ffffff');
        audio.bodyHit(this.panFor(new THREE.Vector3(victim.pos.x, 1, victim.pos.z), cam));
        fx.shake(0.3);
        this.schedule(0.05, () => victim.kill(this.world.physics, dir.clone(), 1.2));
      });
      if (id === localId) {
        this.schedule(1.4, () => {
          this.dying.delete(localId);
          hudStore.set({ spectating: true });
          this.world.cameraRig.mode = 'spectate';
        });
      }
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
      { bodyColor: this.bodyColor(info), accentColor: SUBJECT_COLORS[info.colorIndex] ?? '#e3b23c', subject: info.subject, skin: info.skin, tint: this.view?.config.mode === 'TEAMS' && info.team !== 0 ? TEAM_COLORS[info.team] : undefined },
      label,
      this.laserColor(info),
      this.world.engine.scene,
      isLocal,
    );
    sv.laser.setBright(this.world.chamber.bright);
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
    // Saturated colours on bright maps, glowing pastel ones on dark maps.
    const bright = this.world.chamber.bright;
    const local = this.roster.get(this.session.localId);
    if (settings.laserPalette === 'HIGH_CONTRAST') {
      if (info.id === this.session.localId) return '#00e5ff';
      if (local && local.team !== 0 && local.team === info.team) return '#7dff6a';
      return '#ff2bd6';
    }
    return `#${shade(this.bodyColor(info), bright ? -0.08 : 0.12).getHexString()}`;
  }

  private panFor(p: THREE.Vector3, cam: THREE.Camera): number {
    v3.copy(p).applyMatrix4(cam.matrixWorldInverse);
    return Math.max(-1, Math.min(1, v3.x / 9));
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
