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
  mode: CameraMode = 'menu';
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

  update(
    dt: number,
    subject: Vec2 | null,
    pad: Vec2 | null,
    aimPoint: Vec2 | null,
    shake: THREE.Vector3,
  ): void {
    if (this.mode === 'player' && subject && pad) {
      // Outward direction from the arena centre through this subject's pad.
      const len = Math.hypot(pad.x, pad.z) || 1;
      const ox = pad.x / len;
      const oz = pad.z / len;
      tmpPos.set(subject.x * 0.55 + ox * 8.6, 9.2, subject.z * 0.55 + oz * 8.6);
      tmpLook.set(subject.x * 0.35, 0.4, subject.z * 0.35);
      if (aimPoint) {
        tmpLook.x += (aimPoint.x - tmpLook.x) * 0.12 * this.sway;
        tmpLook.z += (aimPoint.z - tmpLook.z) * 0.12 * this.sway;
      }
      this.damp(tmpPos, tmpLook, dt, 6);
    } else if (this.mode === 'spectate') {
      this.orbit += dt * 0.08;
      tmpPos.set(Math.sin(this.orbit) * 13, 15, Math.cos(this.orbit) * 13);
      tmpLook.set(0, 0, 0);
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
    const k = 1 - Math.exp(-rate * dt);
    this.pos.lerp(pos, k);
    this.look.lerp(look, k);
  }
}
