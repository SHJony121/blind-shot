import * as THREE from 'three';
import { angleDiff, lerp, wrapAngle, type ArenaDef, type RayTarget, type Vec2 } from '@blindshot/shared';
import { LaserSight } from '../weapons/LaserSight';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Ragdoll } from './Ragdoll';
import { SubjectModel, type SubjectLook } from './SubjectModel';
import { canvasTexture, roundRect } from './textures';

const ringGeo = new THREE.RingGeometry(0.62, 0.8, 36);

interface Sample {
  t: number;
  pos: Vec2;
  yaw: number;
  moving: boolean;
}

export type Presence = 'visible' | 'fading' | 'hidden';

/**
 * Everything the client renders for one subject: model, laser, name tag, snapshot
 * interpolation buffer, hide/reveal transition and the ragdoll after death.
 */
export class SubjectView {
  readonly model: SubjectModel;
  readonly laser: LaserSight;
  readonly tag: THREE.Sprite;
  private readonly ring: THREE.Mesh;
  presence: Presence = 'visible';
  ghost = false;
  ragdoll: Ragdoll | null = null;
  /** Current rendered pose. */
  pos: Vec2 = { x: 0, z: 0 };
  yaw = 0;
  moving = false;

  private buffer: Sample[] = [];
  private fadeT = 0;
  private prevYaw = 0;

  constructor(
    readonly id: string,
    look: SubjectLook,
    label: string,
    laserColor: string,
    private readonly scene: THREE.Object3D,
    isLocal: boolean,
  ) {
    this.model = new SubjectModel(look);
    this.laser = new LaserSight(laserColor);
    this.tag = makeNameTag(label, look.accentColor, isLocal);
    this.tag.position.y = 2.85;
    this.model.root.add(this.tag);
    // Coloured ring under the feet: instantly tells subjects apart on a big floor.
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: isLocal ? '#e3b23c' : look.bodyColor, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.model.root.add(this.ring);
    scene.add(this.model.root, this.laser.group);
  }

  /** Push an authoritative sample (time in sim seconds). */
  push(t: number, pos: Vec2, yaw: number, moving: boolean): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && t <= last.t) return;
    this.buffer.push({ t, pos: { ...pos }, yaw, moving });
    if (this.buffer.length > 30) this.buffer.shift();
  }

  /** Jump straight to a pose (spawn, reveal). */
  snap(pos: Vec2, yaw: number, t?: number): void {
    this.buffer = t === undefined ? [] : [{ t, pos: { ...pos }, yaw, moving: false }];
    this.pos = { ...pos };
    this.yaw = yaw;
    this.prevYaw = yaw;
  }

  /** Interpolate the buffer at `renderTime`. */
  sample(renderTime: number): void {
    const b = this.buffer;
    if (b.length === 0) return;
    let i = b.length - 1;
    while (i > 0 && b[i - 1]!.t > renderTime) i--;
    const a = b[Math.max(0, i - 1)]!;
    const c = b[i]!;
    if (renderTime >= c.t || a === c) {
      this.pos = { ...c.pos };
      this.yaw = c.yaw;
      this.moving = c.moving;
      return;
    }
    const k = (renderTime - a.t) / Math.max(1e-6, c.t - a.t);
    const t = Math.max(0, Math.min(1, k));
    this.pos = { x: lerp(a.pos.x, c.pos.x, t), z: lerp(a.pos.z, c.pos.z, t) };
    this.yaw = wrapAngle(a.yaw + angleDiff(a.yaw, c.yaw) * t);
    this.moving = c.moving;
  }

  setPose(pos: Vec2, yaw: number, moving: boolean): void {
    this.pos = { ...pos };
    this.yaw = yaw;
    this.moving = moving;
  }

  /** Start the "flicker out" when the authority stops sending this subject. */
  beginFade(): void {
    if (this.presence !== 'visible') return;
    this.presence = 'fading';
    this.fadeT = 0;
  }

  reveal(): void {
    this.presence = 'visible';
    this.model.root.visible = true;
  }

  hideNow(): void {
    this.presence = 'hidden';
    this.model.root.visible = false;
    this.laser.setActive(false);
  }

  setGhost(ghost: boolean): void {
    this.ghost = ghost;
    this.model.setGhost(ghost);
    this.tag.material.opacity = ghost ? 0.4 : 1;
  }

  kill(physics: PhysicsWorld | null, dir: THREE.Vector3, strength: number): void {
    this.laser.setActive(false);
    this.tag.visible = false;
    this.ring.visible = false;
    if (!physics || this.ragdoll) return;
    this.ragdoll = new Ragdoll(physics, this.model, dir, strength);
  }

  update(dt: number, arena: ArenaDef, targets: readonly RayTarget[], aiming: boolean): void {
    if (this.ragdoll) {
      this.ragdoll.update(dt);
      return;
    }
    if (this.presence === 'fading') {
      this.fadeT += dt;
      // Glitchy stutter, then gone.
      this.model.root.visible = this.fadeT < 0.42 && Math.floor(this.fadeT * 28) % 3 !== 0;
      this.laser.setActive(false);
      if (this.fadeT >= 0.42) this.hideNow();
    }

    const root = this.model.root;
    root.position.set(this.pos.x, 0, this.pos.z);
    root.rotation.y = this.yaw;
    const yawVel = dt > 0 ? angleDiff(this.prevYaw, this.yaw) / dt : 0;
    this.prevYaw = this.yaw;
    this.model.update(dt, { moveAmount: this.moving ? 1 : 0, yawVelocity: yawVel, aiming });
    this.laser.update(dt, arena, this.pos, this.yaw, targets);
  }

  dispose(): void {
    this.ragdoll?.dispose();
    this.ragdoll = null;
    this.laser.dispose();
    this.tag.material.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.model.dispose();
    this.scene.remove(this.model.root);
  }
}

function makeNameTag(label: string, color: string, isLocal: boolean): THREE.Sprite {
  const tex = canvasTexture(`tag-${label}-${color}-${isLocal}`, 512, 128, (g) => {
    g.font = '64px Anton, Impact, sans-serif';
    const w = Math.min(500, g.measureText(label).width + 56);
    const x = (512 - w) / 2;
    g.fillStyle = 'rgba(14,17,20,0.82)';
    roundRect(g, x, 22, w, 84, 14);
    g.fill();
    g.fillStyle = color;
    g.fillRect(x, 22, 12, 84);
    g.fillStyle = isLocal ? '#e3b23c' : '#f2efe6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 256 + 6, 66);
  });
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.0, 0.5, 1);
  sprite.renderOrder = 10;
  return sprite;
}
