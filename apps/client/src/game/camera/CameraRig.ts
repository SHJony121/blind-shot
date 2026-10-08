import * as THREE from 'three';
import type { Vec2 } from '@blindshot/shared';

export type CameraMode = 'player' | 'spectate' | 'menu';

const tmpPos = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const fitDir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const fitPoints = Array.from({ length: 8 }, () => new THREE.Vector3());
/** Default camera tilt above the horizon (radians). */
const DEFAULT_ELEVATION = 0.98;
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
  private menuT = 0;

  private readonly probe = new THREE.PerspectiveCamera();

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
    _aimPoint: Vec2 | null,
    shake: THREE.Vector3,
  ): void {
    const { x: bx, z: bz } = this.bounds;
    // Match starting but no subject yet: hold still and keep the pending cut.
    if (this._mode === 'player' && !subject) return;
    if (this.mode === 'player' || this.mode === 'spectate') {
      // Auto-fit: the whole arena (every corner, with head-room for subjects) is always on
      // screen at the default zoom, whatever the window shape. The view centres on the arena,
      // leaning only slightly toward your subject. Zoom / orbit / tilt stay free on top.
      const lean = this.mode === 'player' && subject ? 0.12 : 0;
      tmpLook.set((subject?.x ?? 0) * lean, 0, (subject?.z ?? 0) * lean);
      this.frameArena(dt, bx, bz);
      this.damp(tmpPos, tmpLook, dt, this.inspect.enabled ? 9 : 5);
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

  /**
   * Place the camera on a sphere around tmpLook (yaw / tilt from the free-look controls),
   * at the distance where every arena corner fits on screen, times the user's zoom.
   */
  private frameArena(dt: number, bx: number, bz: number): void {
    const i = this.inspect;
    const k = 1 - Math.exp(-10 * dt);
    this.zoomS += ((i.enabled ? i.zoom : 1) - this.zoomS) * k;
    this.yawS += ((i.enabled ? i.yaw : 0) - this.yawS) * k;
    this.pitchS += ((i.enabled ? i.pitch : 0) - this.pitchS) * k;
    const elev = Math.max(0.05, Math.min(1.5, DEFAULT_ELEVATION + this.pitchS));
    // Direction from the look point toward the camera (default: behind, on the -Z side).
    fitDir.set(0, Math.sin(elev), -Math.cos(elev)).applyAxisAngle(UP, this.yawS);

    const fit = this.fitDistance(tmpLook, fitDir, bx, bz);
    const wantW = i.enabled && i.focus ? 1 - Math.min(1, this.zoomS) : 0;
    this.focusW += (wantW - this.focusW) * k;
    if (i.focus) this.focusS.set(i.focus.x, 0, i.focus.z);
    tmpLook.lerp(this.focusS, this.focusW);
    tmpPos.copy(tmpLook).addScaledVector(fitDir, fit * this.zoomS);
  }

  /** Smallest camera distance along `dir` at which all arena corners project inside the frame. */
  private fitDistance(look: THREE.Vector3, dir: THREE.Vector3, bx: number, bz: number): number {
    const probe = this.probe;
    probe.fov = this.camera.fov;
    probe.aspect = this.camera.aspect;
    probe.near = 0.1;
    probe.far = 500;
    probe.updateProjectionMatrix();
    const pts = fitPoints;
    let n = 0;
    for (const x of [-bx - 1, bx + 1]) {
      for (const z of [-bz - 1, bz + 1]) {
        for (const y of [0, 2.8]) pts[n++]!.set(x, y, z);
      }
    }
    const fits = (d: number): boolean => {
      probe.position.copy(look).addScaledVector(dir, d);
      probe.lookAt(look);
      probe.updateMatrixWorld(true);
      for (const p of pts) {
        tmpV.copy(p).project(probe);
        // Leave a little room at the top and bottom for the HUD.
        if (tmpV.z > 1 || Math.abs(tmpV.x) > 0.94 || tmpV.y > 0.84 || tmpV.y < -0.84) return false;
        // Behind the camera also means "does not fit".
        if (tmpV.copy(p).sub(probe.position).dot(dir) > 0) return false;
      }
      return true;
    };
    let lo = 4;
    let hi = 300;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  private damp(pos: THREE.Vector3, look: THREE.Vector3, dt: number, rate: number): void {
    const k = this.snap ? 1 : 1 - Math.exp(-rate * dt);
    this.snap = false;
    this.pos.lerp(pos, k);
    this.look.lerp(look, k);
  }
}
