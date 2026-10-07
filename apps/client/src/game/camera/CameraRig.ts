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

  /**
   * Inspect mode (after the freeze): the player can zoom toward a point and orbit around
   * it to check whether a laser really lines up with a target. Eases back when disabled.
   */
  readonly inspect = { enabled: false, zoom: 1, yaw: 0, pitch: 0, focus: null as Vec2 | null };
  private zoomS = 1;
  private yawS = 0;
  private pitchS = 0;
  private focusS = new THREE.Vector3();
  private focusW = 0;

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
      tmpPos.set(fx, height, fz - bz * 0.75 - 2);
      tmpLook.set(fx, 0, fz - bz * 0.05);
      if (aimPoint && !this.inspect.enabled) {
        tmpLook.x += (aimPoint.x - tmpLook.x) * 0.08 * this.sway;
        tmpLook.z += (aimPoint.z - tmpLook.z) * 0.08 * this.sway;
      }
      this.applyInspect(dt);
      this.damp(tmpPos, tmpLook, dt, this.inspect.enabled ? 9 : 5);
    } else if (this.mode === 'spectate') {
      this.orbit += dt * 0.05;
      const r = Math.max(bx, bz) * 0.35;
      tmpPos.set(Math.sin(this.orbit) * r, 17 + bz * 0.7, -bz - 4 + Math.cos(this.orbit) * r * 0.3);
      tmpLook.set(0, 0, 1.5);
      this.applyInspect(dt);
      this.damp(tmpPos, tmpLook, dt, this.inspect.enabled ? 9 : 2);
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

  /** Bend the standard camera target by the inspect zoom / orbit (smoothed). */
  private applyInspect(dt: number): void {
    const i = this.inspect;
    const k = 1 - Math.exp(-10 * dt);
    const on = i.enabled;
    this.zoomS += ((on ? i.zoom : 1) - this.zoomS) * k;
    this.yawS += ((on ? i.yaw : 0) - this.yawS) * k;
    this.pitchS += ((on ? i.pitch : 0) - this.pitchS) * k;
    const wantW = on && i.focus ? 1 - Math.min(1, this.zoomS) : 0;
    this.focusW += (wantW - this.focusW) * k;
    if (i.focus) this.focusS.set(i.focus.x, 0, i.focus.z);
    // Look point slides toward the inspected spot as you zoom in.
    tmpLook.lerp(this.focusS, this.focusW);
    // Orbit + zoom: rotate the offset around the look point, then scale it.
    const off = tmpPos.clone().sub(tmpLook);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yawS);
    const horiz = Math.hypot(off.x, off.z);
    const elev = Math.atan2(off.y, horiz) + this.pitchS;
    const len = off.length() * this.zoomS;
    const clampedElev = Math.max(0.2, Math.min(1.45, elev));
    const dirXZ = horiz > 1e-6 ? { x: off.x / horiz, z: off.z / horiz } : { x: 0, z: -1 };
    tmpPos.set(
      tmpLook.x + dirXZ.x * Math.cos(clampedElev) * len,
      tmpLook.y + Math.sin(clampedElev) * len,
      tmpLook.z + dirXZ.z * Math.cos(clampedElev) * len,
    );
  }

  private damp(pos: THREE.Vector3, look: THREE.Vector3, dt: number, rate: number): void {
    const k = this.snap ? 1 : 1 - Math.exp(-rate * dt);
    this.snap = false;
    this.pos.lerp(pos, k);
    this.look.lerp(look, k);
  }
}
