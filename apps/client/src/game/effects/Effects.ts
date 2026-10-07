import * as THREE from 'three';
import { flashTexture, softDotTexture } from '../characters/textures';
import { ParticleSystem } from './Particles';

interface Timed<T> {
  obj: T;
  age: number;
  life: number;
  active: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

/**
 * Pooled visual effects for the shootout: muzzle flash, light burst, tracers, smoke,
 * wall sparks, impact decals, stylised "stuffing" puffs on hit, steam. All pools are
 * allocated up-front so firing never compiles shaders or allocates mid-frame.
 */
export class Effects {
  readonly group = new THREE.Group();
  readonly sparks = new ParticleSystem(500, true);
  readonly smoke = new ParticleSystem(400, false);

  private readonly flashes: Timed<THREE.Sprite>[] = [];
  private readonly lights: Timed<THREE.PointLight>[] = [];
  private readonly tracers: Timed<THREE.Mesh>[] = [];
  private readonly decals: THREE.Mesh[] = [];
  private decalCursor = 0;
  private trauma = 0;
  private shakeTime = 0;
  reducedFlash = false;

  /** Bright maps: tracers are drawn solid orange instead of additive white. */
  setBright(bright: boolean): void {
    for (const t of this.tracers) {
      const m = t.obj.material as THREE.MeshBasicMaterial;
      m.blending = bright ? THREE.NormalBlending : THREE.AdditiveBlending;
      m.color.set(bright ? '#ff8a1f' : '#fff2c0');
      m.needsUpdate = true;
    }
  }
  shakeEnabled = true;

  constructor() {
    this.group.add(this.sparks.points, this.smoke.points);

    const flashMat = new THREE.SpriteMaterial({
      map: flashTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(flashMat.clone());
      s.visible = false;
      s.renderOrder = 4;
      this.group.add(s);
      this.flashes.push({ obj: s, age: 0, life: 0.09, active: false });
    }
    // Fixed set of lights: never change light count at runtime (that recompiles every shader).
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffc070', 0, 14, 1.5);
      this.group.add(l);
      this.lights.push({ obj: l, age: 0, life: 0.12, active: false });
    }
    const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    tracerGeo.rotateX(Math.PI / 2);
    tracerGeo.translate(0, 0, 0.5);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#fff2c0',
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const m = new THREE.Mesh(tracerGeo, mat);
      m.visible = false;
      m.renderOrder = 4;
      this.group.add(m);
      this.tracers.push({ obj: m, age: 0, life: 0.32, active: false });
    }
    const decalGeo = new THREE.CircleGeometry(0.16, 14);
    const decalMat = new THREE.MeshBasicMaterial({
      map: softDotTexture(),
      color: '#050505',
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    for (let i = 0; i < 40; i++) {
      const d = new THREE.Mesh(decalGeo, decalMat);
      d.visible = false;
      this.group.add(d);
      this.decals.push(d);
    }
  }

  /** Big muzzle flash + light burst + smoke at `pos`, pointing along `dir`. */
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3): void {
    const f = this.flashes.find((x) => !x.active) ?? this.flashes[0];
    if (f) {
      f.active = true;
      f.age = 0;
      f.obj.visible = true;
      f.obj.position.copy(pos).addScaledVector(dir, 0.25);
      (f.obj.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI;
    }
    const l = this.lights.find((x) => !x.active) ?? this.lights[0];
    if (l) {
      l.active = true;
      l.age = 0;
      l.obj.position.copy(pos).addScaledVector(dir, 0.4);
    }
    // Forward cone of hot sparks.
    for (let i = 0; i < 10; i++) {
      tmp.copy(dir).multiplyScalar(6 + Math.random() * 8);
      tmp.x += (Math.random() - 0.5) * 3;
      tmp.y += (Math.random() - 0.3) * 3;
      tmp.z += (Math.random() - 0.5) * 3;
      this.sparks.spawn({ position: pos, velocity: tmp.clone(), color: '#ffd27a', size: 0.12, life: 0.18 + Math.random() * 0.12, drag: 6 });
    }
    // Smoke plume.
    for (let i = 0; i < 6; i++) {
      this.smoke.spawn({
        position: pos.clone().addScaledVector(dir, 0.2 + i * 0.12),
        velocity: dir.clone().multiplyScalar(1.4 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4)),
        color: '#c9ccd0',
        size: 0.45 + Math.random() * 0.3,
        grow: 3.2,
        life: 1.1 + Math.random() * 0.6,
        drag: 1.8,
        alpha: 0.55,
      });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers.find((x) => !x.active) ?? this.tracers[0];
    if (!t) return;
    t.active = true;
    t.age = 0;
    const len = from.distanceTo(to);
    t.obj.visible = true;
    t.obj.position.copy(from);
    t.obj.lookAt(to);
    t.obj.scale.set(0.05, 0.05, len);
  }

  /** Sparks + decal where a bullet hits a wall or pillar. */
  wallImpact(point: THREE.Vector3, normal: THREE.Vector3): void {
    for (let i = 0; i < 18; i++) {
      tmp.copy(normal).multiplyScalar(2 + Math.random() * 4);
      tmp.x += (Math.random() - 0.5) * 5;
      tmp.y += Math.random() * 4;
      tmp.z += (Math.random() - 0.5) * 5;
      this.sparks.spawn({ position: point, velocity: tmp.clone(), color: i % 3 === 0 ? '#ffffff' : '#ffb347', size: 0.08 + Math.random() * 0.06, life: 0.35 + Math.random() * 0.35, gravity: 14 });
    }
    for (let i = 0; i < 4; i++) {
      this.smoke.spawn({
        position: point.clone().addScaledVector(normal, 0.1),
        velocity: normal.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.4, 0)),
        color: '#8d9298',
        size: 0.3,
        grow: 3,
        life: 0.9,
        drag: 2,
        alpha: 0.5,
      });
    }
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    if (d) {
      d.visible = true;
      d.position.copy(point).addScaledVector(normal, 0.02);
      d.lookAt(tmp.copy(point).add(normal));
    }
  }

  /** Cartoon hit: a pop of white fluff and jumpsuit-coloured scraps (no gore). */
  subjectHit(point: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation): void {
    for (let i = 0; i < 16; i++) {
      tmp.copy(dir).multiplyScalar(2 + Math.random() * 3);
      tmp.x += (Math.random() - 0.5) * 3;
      tmp.y += 1 + Math.random() * 3;
      tmp.z += (Math.random() - 0.5) * 3;
      this.smoke.spawn({ position: point, velocity: tmp.clone(), color: i % 2 === 0 ? '#f4f1ea' : color, size: 0.16 + Math.random() * 0.1, life: 0.7 + Math.random() * 0.4, gravity: 9, drag: 1.5 });
    }
    this.sparks.spawn({ position: point, velocity: new THREE.Vector3(), color: '#ffffff', size: 1.6, grow: 1.6, life: 0.12 });
  }

  steam(pos: THREE.Vector3): void {
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn({
        position: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.6 + Math.random(), (Math.random() - 0.5) * 0.3),
        color: '#d8e0e6',
        size: 0.6,
        grow: 4,
        life: 2.2,
        drag: 0.6,
        alpha: 0.22,
      });
    }
  }

  /** Add camera trauma (0..1). Shake magnitude is trauma². */
  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Offset to add to the camera this frame. */
  shakeOffset(out: THREE.Vector3): THREE.Vector3 {
    const s = this.trauma * this.trauma;
    const t = this.shakeTime * 40;
    return out.set(Math.sin(t * 1.3) * s * 0.35, Math.sin(t * 1.7 + 1) * s * 0.3, Math.sin(t * 1.1 + 2) * s * 0.2);
  }

  update(dt: number): void {
    this.shakeTime += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.active = false;
        f.obj.visible = false;
        continue;
      }
      const s = (this.reducedFlash ? 1.1 : 1.9) * (0.6 + t * 0.8);
      f.obj.scale.setScalar(s);
      (f.obj.material as THREE.SpriteMaterial).opacity = (1 - t) * (this.reducedFlash ? 0.5 : 1);
    }
    for (const l of this.lights) {
      if (!l.active) continue;
      l.age += dt;
      const t = l.age / l.life;
      if (t >= 1) {
        l.active = false;
        l.obj.intensity = 0;
        continue;
      }
      l.obj.intensity = (1 - t) * (this.reducedFlash ? 25 : 70);
    }
    for (const tr of this.tracers) {
      if (!tr.active) continue;
      tr.age += dt;
      const t = tr.age / tr.life;
      if (t >= 1) {
        tr.active = false;
        tr.obj.visible = false;
        continue;
      }
      const w = 0.06 * (1 - t) + 0.01;
      tr.obj.scale.x = w;
      tr.obj.scale.y = w;
      (tr.obj.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  clearDecals(): void {
    for (const d of this.decals) d.visible = false;
  }
}

export { UP };
