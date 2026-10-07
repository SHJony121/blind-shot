import { SUBJECT_COLORS } from '@blindshot/shared';
import { SubjectModel } from '../characters/SubjectModel';
import type { ClientWorld } from './ClientWorld';

/**
 * Main-menu backdrop: one test subject idling in the chamber with the oversized gun,
 * flickering lights, steam and a slowly drifting camera.
 */
export class MenuDirector {
  private hero: SubjectModel | null = null;
  private stopUpdate: (() => void) | null = null;
  private t = 0;
  private aimUntil = 0;
  private nextGesture = 4;
  private yaw = 0;

  constructor(private readonly world: ClientWorld) {}

  start(): void {
    if (this.hero) return;
    this.hero = new SubjectModel({ bodyColor: SUBJECT_COLORS[0], accentColor: SUBJECT_COLORS[0], subject: 1 });
    this.hero.root.position.set(0, 0, 3.4);
    this.world.engine.scene.add(this.hero.root);
    this.world.cameraRig.mode = 'menu';
    this.world.chamber.setMood('menu');
    this.stopUpdate = this.world.addUpdate((dt) => this.update(dt));
  }

  stop(): void {
    this.stopUpdate?.();
    this.stopUpdate = null;
    this.hero?.dispose();
    this.hero = null;
  }

  private update(dt: number): void {
    const hero = this.hero;
    if (!hero) return;
    this.t += dt;
    this.nextGesture -= dt;
    if (this.nextGesture <= 0) {
      this.aimUntil = this.t + 2.2;
      this.nextGesture = 6 + Math.random() * 4;
    }
    const aiming = this.t < this.aimUntil;
    const targetYaw = aiming ? 0.55 : 0.18 + Math.sin(this.t * 0.4) * 0.12;
    const prev = this.yaw;
    this.yaw += (targetYaw - this.yaw) * Math.min(1, dt * 3);
    hero.root.rotation.y = this.yaw;
    hero.update(dt, { moveAmount: 0, yawVelocity: (this.yaw - prev) / Math.max(dt, 1e-4), aiming });
  }
}
