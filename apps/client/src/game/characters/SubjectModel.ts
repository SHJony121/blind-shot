import * as THREE from 'three';
import type { SkinId } from '@blindshot/shared';
import { GunModel } from '../weapons/GunModel';
import { inkedMesh, shade, toon } from './materials';
import { crashMarkerTexture, numberPatchTexture } from './textures';

/** Shared geometry for every subject (built once). */
const G = {
  pelvis: new THREE.SphereGeometry(0.32, 18, 12),
  torso: new THREE.CapsuleGeometry(0.35, 0.28, 8, 18),
  collar: new THREE.TorusGeometry(0.2, 0.06, 8, 18),
  belt: new THREE.TorusGeometry(0.335, 0.05, 8, 24),
  buckle: new THREE.BoxGeometry(0.12, 0.09, 0.04),
  head: new THREE.SphereGeometry(0.4, 22, 16),
  helmet: new THREE.SphereGeometry(0.43, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
  helmetRim: new THREE.TorusGeometry(0.405, 0.035, 8, 28),
  visor: new THREE.CylinderGeometry(0.415, 0.415, 0.2, 24, 1, true, -1.15, 2.3),
  eye: new THREE.CapsuleGeometry(0.035, 0.05, 4, 8),
  marker: new THREE.CircleGeometry(0.1, 18),
  patch: new THREE.PlaneGeometry(0.32, 0.24),
  backPatch: new THREE.PlaneGeometry(0.42, 0.32),
  upperArm: new THREE.CapsuleGeometry(0.105, 0.3, 6, 12),
  glove: new THREE.SphereGeometry(0.13, 14, 10),
  leg: new THREE.CapsuleGeometry(0.135, 0.28, 6, 12),
  boot: new THREE.SphereGeometry(0.17, 14, 10),
  pack: new THREE.BoxGeometry(0.36, 0.4, 0.16),
  robotHead: new THREE.BoxGeometry(0.78, 0.66, 0.7, 2, 2, 2),
  screen: new THREE.PlaneGeometry(0.6, 0.3),
  antenna: new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6),
  knob: new THREE.SphereGeometry(0.07, 10, 8),
  bubble: new THREE.SphereGeometry(0.52, 24, 16),
  bubbleRing: new THREE.TorusGeometry(0.4, 0.07, 8, 24),
  hardHat: new THREE.SphereGeometry(0.44, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
  brim: new THREE.CylinderGeometry(0.56, 0.56, 0.04, 28),
  beanie: new THREE.SphereGeometry(0.43, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
  beanieFold: new THREE.TorusGeometry(0.4, 0.07, 8, 28),
  pompom: new THREE.SphereGeometry(0.11, 10, 8),
  ear: new THREE.ConeGeometry(0.14, 0.26, 4),
  dot: new THREE.SphereGeometry(0.05, 10, 8),
  mouth: new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI),
};

export const SKIN_LABELS: Record<SkinId, string> = {
  DUMMY: 'TEST DUMMY',
  ROBOT: 'UNIT BOT',
  ASTRO: 'ASTRO',
  WORKER: 'HARD HAT',
  BEANIE: 'BEANIE',
  CAT: 'KITTY',
};

export const SUBJECT_PART_NAMES = ['hips', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'] as const;
export type SubjectPartName = (typeof SUBJECT_PART_NAMES)[number];

export interface SubjectLook {
  bodyColor: string;
  accentColor: string;
  subject: number;
  skin?: SkinId;
}

interface HeadMaterials {
  skin: THREE.Material;
  helmetMat: THREE.Material;
  rubber: THREE.Material;
  visorMat: THREE.Material;
  eyeMat: THREE.Material;
  suit: THREE.Material;
}

export interface SubjectAnimInput {
  /** 0..1 how fast the subject moves this frame. */
  moveAmount: number;
  /** rad/s, positive = turning left. */
  yawVelocity: number;
  /** Aim pose raised (arms up) vs relaxed (menu idle). */
  aiming: boolean;
}

/**
 * Original stylised "test subject": chunky jumpsuit body, oversized helmeted head with a
 * visor face, short limbs, big gloves and boots. Built procedurally from smooth primitives,
 * toon-shaded and ink-outlined. Animation is procedural (idle, walk, turn, aim, recoil, spawn).
 */
export class SubjectModel {
  readonly root = new THREE.Group();
  readonly parts: Record<SubjectPartName, THREE.Group>;
  readonly gun = new GunModel();
  readonly materials: THREE.MeshToonMaterial[] = [];

  private readonly gunMount = new THREE.Group();
  private readonly armRest = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  private readonly armAim = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  private aimBlend = 1;
  private walkPhase = Math.random() * 10;
  private breath = Math.random() * 10;
  private moveSmooth = 0;
  private twist = 0;
  private recoil = 0;
  private hitFlash = 0;
  private dropT = 1;
  private ghost = false;

  constructor(readonly look: SubjectLook) {
    const suit = toon(look.bodyColor);
    const suitDark = toon(shade(look.bodyColor, -0.12));
    const helmetMat = toon(shade(look.accentColor, -0.04));
    const skin = toon('#efe3cc');
    const rubber = toon('#2b2f36');
    const visorMat = new THREE.MeshPhongMaterial({ color: '#141b22', shininess: 90, specular: '#7f93a8' });
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#f4f7f2' });
    const buckleMat = toon('#c9a24a');
    this.materials.push(suit, suitDark, helmetMat, skin, rubber);

    const hips = new THREE.Group();
    const torso = new THREE.Group();
    const head = new THREE.Group();
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    this.parts = { hips, torso, head, armL, armR, legL, legR };
    for (const [name, g] of Object.entries(this.parts)) g.name = name;

    // Hips
    hips.position.y = 0.72;
    const pelvis = inkedMesh(G.pelvis, suitDark);
    pelvis.scale.set(1, 0.68, 0.84);
    hips.add(pelvis);

    // Legs
    for (const [leg, side] of [
      [legL, 1],
      [legR, -1],
    ] as const) {
      leg.position.set(0.17 * side, -0.06, 0);
      const thigh = inkedMesh(G.leg, suit);
      thigh.position.y = -0.27;
      const boot = inkedMesh(G.boot, rubber);
      boot.scale.set(0.95, 0.62, 1.35);
      boot.position.set(0, -0.6, 0.06);
      leg.add(thigh, boot);
      hips.add(leg);
    }

    // Torso
    torso.position.y = 0.1;
    const chest = inkedMesh(G.torso, suit);
    chest.position.y = 0.36;
    chest.scale.set(1.06, 1, 0.86);
    const belt = new THREE.Mesh(G.belt, rubber);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.07, 0.87, 1);
    belt.position.y = 0.04;
    const buckle = new THREE.Mesh(G.buckle, buckleMat);
    buckle.position.set(0, 0.04, 0.3);
    const collar = inkedMesh(G.collar, suitDark, 0.015);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.8;
    const patch = new THREE.Mesh(
      G.patch,
      new THREE.MeshBasicMaterial({ map: numberPatchTexture(look.subject), transparent: true }),
    );
    patch.position.set(0, 0.44, 0.305);
    patch.rotation.x = -0.08;
    const pack = inkedMesh(G.pack, suitDark, 0.015);
    pack.position.set(0, 0.42, -0.32);
    const backPatch = new THREE.Mesh(
      G.backPatch,
      new THREE.MeshBasicMaterial({ map: numberPatchTexture(look.subject), transparent: true }),
    );
    backPatch.position.set(0, 0.44, -0.405);
    backPatch.rotation.y = Math.PI;
    torso.add(chest, belt, buckle, collar, patch, pack, backPatch);
    hips.add(torso);

    // Head: one of several original looks (see buildHead).
    head.position.y = 0.8;
    this.buildHead(head, look.skin ?? 'DUMMY', { skin, helmetMat, rubber, visorMat, eyeMat, suit });
    torso.add(head);

    // Arms: shoulder pivots; the static aim pose points both hands at the gun grip.
    for (const [arm, side] of [
      [armL, 1],
      [armR, -1],
    ] as const) {
      arm.position.set(0.43 * side, 0.6, 0);
      const upper = inkedMesh(G.upperArm, suit);
      upper.position.y = -0.24;
      const glove = inkedMesh(G.glove, rubber);
      glove.scale.set(1, 0.9, 1.1);
      glove.position.y = -0.52;
      arm.add(upper, glove);
      torso.add(arm);
      const key = side === 1 ? 'L' : 'R';
      const shoulder = new THREE.Vector3(0.43 * side, 0.6, 0);
      const grip = new THREE.Vector3(0.07 * side, 0.27, 0.42);
      const dir = grip.sub(shoulder).normalize();
      this.armAim[key].setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      this.armRest[key].setFromUnitVectors(
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0.18 * side, -1, 0.35).normalize(),
      );
    }

    // Gun held in front of the chest. Muzzle ends up at MUZZLE_HEIGHT / MUZZLE_FORWARD.
    this.gunMount.position.set(0, 0.32, 0.44);
    this.gunMount.add(this.gun.group);
    torso.add(this.gunMount);

    this.root.add(hips);
  }

  private buildHead(head: THREE.Group, skin: SkinId, m: HeadMaterials): void {
    const face = (eyesY: number, z: number, mouth = true) => {
      for (const side of [1, -1]) {
        const eye = new THREE.Mesh(G.dot, new THREE.MeshBasicMaterial({ color: '#15181c' }));
        eye.position.set(0.13 * side, eyesY, z);
        eye.scale.set(1, 1.35, 0.6);
        head.add(eye);
      }
      if (mouth) {
        const smile = new THREE.Mesh(G.mouth, new THREE.MeshBasicMaterial({ color: '#15181c' }));
        smile.position.set(0, eyesY - 0.13, z - 0.01);
        smile.rotation.z = Math.PI;
        head.add(smile);
      }
    };
    const skull = () => {
      const sk = inkedMesh(G.head, m.skin);
      sk.position.y = 0.33;
      head.add(sk);
    };

    if (skin === 'ROBOT') {
      const box = inkedMesh(G.robotHead, m.helmetMat, 0.02);
      box.position.y = 0.36;
      const screen = new THREE.Mesh(G.screen, m.visorMat);
      screen.position.set(0, 0.36, 0.352);
      for (const side of [1, -1]) {
        const eye = new THREE.Mesh(G.eye, m.eyeMat);
        eye.position.set(0.13 * side, 0.37, 0.36);
        head.add(eye);
      }
      const antenna = new THREE.Mesh(G.antenna, m.rubber);
      antenna.position.set(0.18, 0.82, 0);
      const knob = new THREE.Mesh(G.knob, new THREE.MeshBasicMaterial({ color: '#ff4b3a' }));
      knob.position.set(0.18, 0.98, 0);
      head.add(box, screen, antenna, knob);
      return;
    }
    if (skin === 'ASTRO') {
      skull();
      face(0.38, 0.39);
      const glass = new THREE.Mesh(
        G.bubble,
        new THREE.MeshPhongMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.28, shininess: 120, specular: '#ffffff', depthWrite: false }),
      );
      glass.position.y = 0.36;
      const ring = inkedMesh(G.bubbleRing, m.suit, 0.015);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.02;
      head.add(glass, ring);
      return;
    }
    if (skin === 'WORKER') {
      skull();
      face(0.33, 0.39);
      const hat = inkedMesh(G.hardHat, new THREE.MeshToonMaterial({ color: '#f2c230', gradientMap: (m.suit as THREE.MeshToonMaterial).gradientMap }), 0.02);
      hat.position.y = 0.46;
      const brim = new THREE.Mesh(G.brim, new THREE.MeshToonMaterial({ color: '#e0ad1c', gradientMap: (m.suit as THREE.MeshToonMaterial).gradientMap }));
      brim.position.set(0, 0.47, 0.06);
      head.add(hat, brim);
      return;
    }
    if (skin === 'BEANIE') {
      skull();
      face(0.3, 0.39);
      const hat = inkedMesh(G.beanie, m.helmetMat, 0.02);
      hat.position.y = 0.43;
      const fold = new THREE.Mesh(G.beanieFold, m.rubber);
      fold.rotation.x = Math.PI / 2;
      fold.position.y = 0.47;
      const pom = inkedMesh(G.pompom, m.skin, 0.015);
      pom.position.y = 0.9;
      head.add(hat, fold, pom);
      return;
    }

    // DUMMY (default) and CAT: dummy face, coloured helmet, dark visor with two bright eyes.
    skull();
    const helmet = inkedMesh(G.helmet, m.helmetMat, 0.02);
    helmet.position.y = 0.36;
    helmet.rotation.x = -0.25;
    const rim = new THREE.Mesh(G.helmetRim, m.rubber);
    rim.position.y = 0.42;
    rim.rotation.x = Math.PI / 2 - 0.25;
    const visor = new THREE.Mesh(G.visor, m.visorMat);
    visor.position.y = 0.3;
    for (const side of [1, -1]) {
      const eye = new THREE.Mesh(G.eye, m.eyeMat);
      eye.position.set(0.12 * side, 0.31, 0.415);
      head.add(eye);
      if (skin === 'CAT') {
        const ear = inkedMesh(G.ear, m.helmetMat, 0.015);
        ear.position.set(0.24 * side, 0.82, -0.02);
        ear.rotation.z = -0.35 * side;
        ear.rotation.y = Math.PI / 4;
        head.add(ear);
      } else {
        const marker = new THREE.Mesh(G.marker, new THREE.MeshBasicMaterial({ map: crashMarkerTexture(), transparent: true }));
        marker.position.set(0.432 * side, 0.36, -0.02);
        marker.rotation.y = (Math.PI / 2) * side;
        head.add(marker);
      }
    }
    head.add(helmet, rim, visor);
  }

  /** World-space muzzle position (visual). */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.gun.muzzle.getWorldPosition(target);
  }

  fire(): void {
    this.recoil = 1;
  }

  flashHit(): void {
    this.hitFlash = 1;
  }

  /** Drop-in spawn animation. */
  spawnDrop(): void {
    this.dropT = 0;
  }

  setGhost(ghost: boolean): void {
    if (this.ghost === ghost) return;
    this.ghost = ghost;
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name === 'outline') {
        mesh.visible = !ghost;
        return;
      }
      mesh.castShadow = !ghost;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m.userData.baseTransparent === undefined) m.userData.baseTransparent = m.transparent;
        m.transparent = ghost || m.userData.baseTransparent === true;
        m.opacity = ghost ? 0.28 : 1;
        m.depthWrite = !ghost;
        m.needsUpdate = true;
      }
    });
  }

  update(dt: number, anim: SubjectAnimInput): void {
    const { hips, torso, head, armL, armR, legL, legR } = this.parts;

    this.moveSmooth += (anim.moveAmount - this.moveSmooth) * Math.min(1, dt * 12);
    this.walkPhase += dt * (6 + 5 * this.moveSmooth) * (this.moveSmooth > 0.05 ? 1 : 0);
    this.breath += dt * 2.2;
    this.recoil = Math.max(0, this.recoil - dt * 3.2);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.dropT = Math.min(1, this.dropT + dt * 2.2);
    this.aimBlend += ((anim.aiming ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 8);
    const targetTwist = THREE.MathUtils.clamp(-anim.yawVelocity * 0.06, -0.4, 0.4);
    this.twist += (targetTwist - this.twist) * Math.min(1, dt * 10);

    // Walk cycle.
    const swing = Math.sin(this.walkPhase) * 0.65 * this.moveSmooth;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    const bob = Math.abs(Math.cos(this.walkPhase)) * 0.06 * this.moveSmooth;

    // Spawn drop with a squash on landing.
    const t = this.dropT;
    const fall = t < 0.55 ? (1 - t / 0.55) ** 2 * 3.2 : 0;
    const squash = t >= 0.55 ? Math.sin(((t - 0.55) / 0.45) * Math.PI) * 0.18 * (1 - t) * 2 : 0;
    hips.position.y = 0.72 + bob + fall - squash * 0.3;
    this.root.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);

    // Breathing + turn twist + recoil (upper torso leads; gun reads clearly).
    const r = this.recoil * this.recoil;
    torso.scale.y = 1 + Math.sin(this.breath) * 0.012;
    torso.rotation.y = this.twist;
    torso.rotation.z = -this.twist * 0.25 + Math.sin(this.walkPhase) * 0.04 * this.moveSmooth;
    torso.rotation.x = -r * 0.42 + this.moveSmooth * 0.06;
    head.rotation.x = -r * 0.25 + Math.sin(this.breath * 0.5) * 0.02;
    head.rotation.y = -this.twist * 0.5;
    this.gun.setRecoil(r);

    armL.quaternion.slerpQuaternions(this.armRest.L, this.armAim.L, this.aimBlend);
    armR.quaternion.slerpQuaternions(this.armRest.R, this.armAim.R, this.aimBlend);
    if (r > 0) {
      armL.rotateX(-r * 0.5);
      armR.rotateX(-r * 0.5);
    }
    this.gunMount.position.y = THREE.MathUtils.lerp(0.05, 0.32, this.aimBlend);
    this.gunMount.position.z = THREE.MathUtils.lerp(0.3, 0.44, this.aimBlend);
    this.gunMount.rotation.x = THREE.MathUtils.lerp(0.9, 0, this.aimBlend);

    const flash = this.hitFlash;
    for (const m of this.materials) m.emissive.setRGB(flash * 0.7, flash * 0.6, flash * 0.5);
  }

  dispose(): void {
    // Parts may have been re-parented to the scene by a ragdoll, so release them individually.
    const roots = [this.root, this.gun.group, ...Object.values(this.parts)];
    const released = new Set<THREE.Material>();
    for (const r of roots) {
      r.removeFromParent();
      // Geometry is shared between subjects; only per-subject materials are released.
      r.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.name === 'outline') return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (released.has(m)) continue;
          released.add(m);
          m.dispose();
        }
      });
    }
  }
}
