import * as THREE from 'three';
import { TEST_CHAMBER_01, type ArenaDef } from '@blindshot/shared';
import { audio } from '../audio/AudioEngine';
import { CameraRig } from '../camera/CameraRig';
import { Effects } from '../effects/Effects';
import { TestChamber } from '../maps/TestChamber';
import { loadRapier, PhysicsWorld } from '../physics/PhysicsWorld';
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
  readonly arena: ArenaDef = TEST_CHAMBER_01;
  readonly chamber: TestChamber;
  readonly effects = new Effects();
  readonly cameraRig: CameraRig;
  physics: PhysicsWorld | null = null;

  /** Per-frame hooks for whoever currently drives the camera (menu or match). */
  cameraTarget: () => { subject: { x: number; z: number } | null; pad: { x: number; z: number } | null; aim: { x: number; z: number } | null } = () => ({
    subject: null,
    pad: null,
    aim: null,
  });

  private steamIn = 2;
  private readonly hooks = new Set<(dt: number) => void>();

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas);
    this.input = new Input(canvas);
    this.chamber = new TestChamber(this.arena, this.engine.renderer);
    this.cameraRig = new CameraRig(this.engine.camera);
    this.engine.scene.add(this.chamber.group, this.effects.group);

    const applySettings = () => {
      const s = settingsStore.get();
      this.effects.shakeEnabled = s.screenShake;
      this.effects.reducedFlash = s.reducedFlash;
      this.cameraRig.sway = s.cameraSway;
      this.engine.setShadows(s.shadows);
      audio.setVolumes({ master: s.masterVolume, sfx: s.sfxVolume, music: s.musicVolume });
    };
    applySettings();
    settingsStore.subscribe(applySettings);

    this.engine.onFrame((dt) => this.update(dt));
  }

  async initPhysics(): Promise<void> {
    const R = await loadRapier();
    this.physics = new PhysicsWorld(R, this.arena);
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
    this.cameraRig.update(dt, t.subject, t.pad, t.aim, this.effects.shakeOffset(shakeTmp));
  }
}
