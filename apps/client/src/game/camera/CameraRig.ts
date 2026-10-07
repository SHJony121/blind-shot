import * as THREE from 'three';
import type { Vec2 } from '@blindshot/shared';

export type CameraMode = 'player' | 'spectate' | 'menu';

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();

/**
 * Elevated third-person camera. It sits outside the ring behind the local subject and
 * looks across the arena, so every opponent and every laser is on screen at once.
 * Damped, with a gentle lean toward the aim point and trauma-based shake.
 */
export class CameraRig {
  private _mode: CameraMode = 'menu';
  /** Jump straight to the next target instead of gliding (mode switches between menu and match). */
  private snap = true;

  get mode(): CameraMode {
    return this._mode;
  }

  set mode(m: CameraMode) {
    if (m === this._mode) return;
    // Menu <-> match is a hard cut; player <-> spectate keeps the smooth glide.
    if (m === 'menu' || this._mode === 'menu') this.snap = true;
    this._mode = m;
  }
  sway = 0.5;
  private readonly pos = new THREE.Vector3(0, 9, -16);
  private readonly look = new THREE.Vector3(0, 1, 0);
  private orbit = 0;
  private menuT = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Immediately place the camera (no damping), e.g. on match start. */
  cut(): void {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  /** Arena half extents, used to frame the floor. */
  bounds = { x: 14, z: 14 };

  update(
    dt: number,
    subject: Vec2 | null,
    aimPoint: Vec2 | null,
    shake: THREE.Vector3,
  ): void {
    const { x: bx, z: bz } = this.bounds;
    // Match starting but no subject yet: hold still and keep the pending cut.
    if (this._mode === 'player' && !subject) return;
    if (this.mode === 'player' && subject) {
      // High, behind (-Z side), following the subject part of the way so the whole floor
      // stays readable: you always see where everyone is and where they aim.
      const fx = subject.x * 0.65;
      const fz = subject.z * 0.45;
      const height = 7 + bz * 1.0;
      tmpPos.set(fx, height, fz - bz * 0.8 - 3);
      tmpLook.set(fx, 0, fz - bz * 0.2);
      if (aimPoint) {
        tmpLook.x += (aimPoint.x - tmpLook.x) * 0.08 * this.sway;
        tmpLook.z += (aimPoint.z - tmpLook.z) * 0.08 * this.sway;
      }
      this.damp(tmpPos, tmpLook, dt, 5);
    } else if (this.mode === 'spectate') {
      this.orbit += dt * 0.05;
      const r = Math.max(bx, bz) * 0.35;
      tmpPos.set(Math.sin(this.orbit) * r, 17 + bz * 0.7, -bz - 4 + Math.cos(this.orbit) * r * 0.3);
      tmpLook.set(0, 0, 1.5);
      this.damp(tmpPos, tmpLook, dt, 2);
    } else {
      // Menu: slow drift around the hero subject standing in front of the pillars.
      this.menuT += dt;
      tmpPos.set(-0.7 + Math.sin(this.menuT * 0.12) * 0.4, 1.9 + Math.sin(this.menuT * 0.2) * 0.1, 8.2 + Math.cos(this.menuT * 0.1) * 0.3);
      tmpLook.set(-0.95, 1.3, 3.4);
      this.damp(tmpPos, tmpLook, dt, 3);
    }
    this.camera.position.copy(this.pos).add(shake);
    this.camera.lookAt(this.look);
  }

  private damp(pos: THREE.Vector3, look: THREE.Vector3, dt: number, rate: number): void {
    const k = this.snap ? 1 : 1 - Math.exp(-rate * dt);
    this.snap = false;
    this.pos.lerp(pos, k);
    this.look.lerp(look, k);
  }
}
