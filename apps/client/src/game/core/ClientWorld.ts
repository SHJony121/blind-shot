import * as THREE from 'three';
import { getArena, TEST_CHAMBER_01, type ArenaDef, type MapId } from '@blindshot/shared';
import { audio } from '../audio/AudioEngine';
import { CameraRig } from '../camera/CameraRig';
import { Effects } from '../effects/Effects';
import { ArenaView } from '../maps/ArenaView';
import { loadRapier, PhysicsWorld, type Rapier } from '../physics/PhysicsWorld';
import { settingsStore } from '../../state/settings';
import { Engine } from './Engine';
import { Input } from './Input';

const shakeTmp = new THREE.Vector3();

/**
 * The persistent 3D world: engine, chamber, effects, physics, camera and input.
 * Menus and matches borrow it; it lives for the whole page.
 */
export class ClientWorld {
  readonly engine: Engine;
  readonly input: Input;
  arena: ArenaDef = TEST_CHAMBER_01;
  chamber: ArenaView;
  readonly effects = new Effects();
  readonly cameraRig: CameraRig;
  physics: PhysicsWorld | null = null;

  /** Per-frame hooks for whoever currently drives the camera (menu or match). */
  cameraTarget: () => { subject: { x: number; z: number } | null; aim: { x: number; z: number } | null } = () => ({
    subject: null,
    aim: null,
  });

  private steamIn = 2;
  private readonly hooks = new Set<(dt: number) => void>();

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.chamber = new ArenaView(this.arena, this.engine.renderer);
    this.cameraRig = new CameraRig(this.engine.camera);
    this.engine.scene.add(this.chamber.group, this.effects.group);

    const applySettings = () => {
      const s = settingsStore.get();
      this.effects.shakeEnabled = s.screenShake;
      this.effects.reducedFlash = s.reducedFlash;
      this.cameraRig.sway = s.cameraSway;
      this.engine.setShadows(s.shadows);
      audio.setVolumes({ master: s.masterVolume, sfx: s.soundOn ? s.sfxVolume : 0, music: s.musicOn ? s.musicVolume : 0 });
    };
    applySettings();
    settingsStore.subscribe(applySettings);

    this.engine.onFrame((dt) => this.update(dt));
  }

  private rapier: Rapier | null = null;

  async initPhysics(): Promise<void> {
    this.rapier = await loadRapier();
    this.physics = new PhysicsWorld(this.rapier, this.arena);
  }

  /** Swap the arena (visuals + ragdoll physics). Keeps lighting mood. */
  setArena(id: MapId): void {
    if (this.arena.id === id) return;
    this.arena = getArena(id);
    this.chamber.dispose();
    this.chamber = new ArenaView(this.arena, this.engine.renderer);
    this.engine.scene.add(this.chamber.group);
    this.physics?.dispose();
    this.physics = this.rapier ? new PhysicsWorld(this.rapier, this.arena) : null;
    this.effects.clearDecals();
  }

  start(): void {
    this.engine.start();
  }

  /** Run `fn` every frame after physics/effects and before the camera. */
  addUpdate(fn: (dt: number) => void): () => void {
    this.hooks.add(fn);
    return () => this.hooks.delete(fn);
  }

  private update(dt: number): void {
    this.physics?.step(dt);
    this.chamber.update(dt);
    this.effects.update(dt);

    this.steamIn -= dt;
    if (this.steamIn <= 0) {
      const vent = this.chamber.ventPositions[Math.floor(Math.random() * this.chamber.ventPositions.length)];
      if (vent) this.effects.steam(vent);
      if (this.steamIn < -0.6) this.steamIn = 1.5 + Math.random() * 4;
    }

    for (const hook of this.hooks) hook(dt);

    const t = this.cameraTarget();
    this.cameraRig.bounds = { x: this.arena.halfX, z: this.arena.halfZ };
    this.cameraRig.update(dt, t.subject, t.aim, this.effects.shakeOffset(shakeTmp));
  }
}
