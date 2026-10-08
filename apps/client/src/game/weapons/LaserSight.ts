import * as THREE from 'three';
import { castRay, MUZZLE_HEIGHT, muzzleOrigin, yawToDir, type ArenaDef, type RayTarget } from '@blindshot/shared';
import { softDotTexture } from '../characters/textures';

const beamGeo = new THREE.BoxGeometry(1, 1, 1);
beamGeo.translate(0, 0, 0.5);

/**
 * Laser sight: a raycast from the gameplay muzzle along the aim direction that stops on
 * the first wall, pillar or visible subject. Uses the exact same shared raycast as
 * shot resolution, so "the laser touches me" means "that shot would hit me".
 */
export class LaserSight {
  readonly group = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly dot: THREE.Sprite;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly dotMat: THREE.SpriteMaterial;
  private opacity = 0;
  private targetOpacity = 0;
  private pulse = Math.random() * 10;
  private brightScale = 1;

  constructor(color: THREE.ColorRepresentation) {
    this.coreMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.dotMat = new THREE.SpriteMaterial({ map: softDotTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.core = new THREE.Mesh(beamGeo, this.coreMat);
    this.glow = new THREE.Mesh(beamGeo, this.glowMat);
    this.dot = new THREE.Sprite(this.dotMat);
    this.core.renderOrder = 5;
    this.glow.renderOrder = 5;
    this.dot.renderOrder = 6;
    this.group.add(this.core, this.glow, this.dot);
    this.group.visible = false;
  }

  /** On bright floors additive light vanishes: draw solid, saturated beams instead. */
  setBright(bright: boolean): void {
    const blending = bright ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [this.coreMat, this.glowMat, this.dotMat]) {
      m.blending = blending;
      m.needsUpdate = true;
    }
    this.coreMat.color.set(bright ? this.glowMat.color.clone().multiplyScalar(0.75) : '#ffffff');
    this.brightScale = bright ? 1.6 : 1;
  }

  setColor(color: THREE.ColorRepresentation): void {
    this.glowMat.color.set(color);
    this.dotMat.color.set(color);
  }

  /** Switch off immediately (no fade). */
  hideNow(): void {
    this.targetOpacity = 0;
    this.opacity = 0;
    this.group.visible = false;
  }

  /** `strength` 0..1 — 1 = full laser, ~0.3 = faint (teammate ghosts). */
  setActive(active: boolean, strength = 1): void {
    this.targetOpacity = active ? strength : 0;
  }

  update(
    dt: number,
    arena: ArenaDef,
    pos: { x: number; z: number },
    yaw: number,
    targets: readonly RayTarget[],
  ): void {
    const k = Math.min(1, dt * (this.targetOpacity > this.opacity ? 30 : 14));
    this.opacity += (this.targetOpacity - this.opacity) * k;
    this.group.visible = this.opacity > 0.01;
    if (!this.group.visible) return;

    const origin = muzzleOrigin(pos, yaw);
    const dir = yawToDir(yaw);
    // Capped so a beam running off a floating edge does not sweep past the camera.
    const hit = castRay(arena, origin, dir, targets, 36);
    const len = Math.max(0.01, hit.distance);
    this.pulse += dt * 9;
    const flicker = 0.85 + Math.sin(this.pulse) * 0.08 + Math.random() * 0.07;

    this.core.position.set(origin.x, MUZZLE_HEIGHT, origin.z);
    this.core.rotation.set(0, yaw, 0);
    this.core.scale.set(0.02, 0.02, len);
    this.glow.position.copy(this.core.position);
    this.glow.rotation.copy(this.core.rotation);
    this.glow.scale.set(0.085, 0.085, len);
    this.dot.position.set(hit.end.x - dir.x * 0.05, MUZZLE_HEIGHT, hit.end.z - dir.z * 0.05);
    const dotSize = hit.surface === 'SUBJECT' ? 0.75 : 0.45;
    this.dot.scale.setScalar(dotSize * (0.9 + Math.random() * 0.2));

    this.coreMat.opacity = Math.min(1, this.opacity * 0.9 * flicker * this.brightScale);
    this.glowMat.opacity = Math.min(1, this.opacity * 0.55 * flicker * (this.brightScale > 1 ? 0.6 : 1));
    this.dotMat.opacity = this.opacity;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.coreMat.dispose();
    this.glowMat.dispose();
    this.dotMat.dispose();
  }
}
