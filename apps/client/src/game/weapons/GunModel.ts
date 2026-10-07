import * as THREE from 'three';
import { inkedMesh, toon } from '../characters/materials';

const geo = {
  grip: new THREE.BoxGeometry(0.11, 0.24, 0.13),
  body: new THREE.BoxGeometry(0.17, 0.17, 0.36),
  drum: new THREE.CylinderGeometry(0.11, 0.11, 0.17, 7),
  barrel: new THREE.CylinderGeometry(0.072, 0.08, 0.4, 14),
  muzzle: new THREE.CylinderGeometry(0.098, 0.098, 0.08, 14),
  rail: new THREE.BoxGeometry(0.05, 0.05, 0.3),
  hammer: new THREE.BoxGeometry(0.06, 0.09, 0.07),
  guard: new THREE.TorusGeometry(0.06, 0.016, 6, 12, Math.PI),
  bolt: new THREE.SphereGeometry(0.03, 8, 6),
};

/**
 * Original "industrial test pistol": oversized drum, thick barrel, orange hazard muzzle.
 * Built facing +Z with the grip at the origin; `muzzle` marks the barrel tip.
 */
export class GunModel {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private readonly kick = new THREE.Group();

  constructor() {
    const steel = toon('#6f7d89');
    const dark = toon('#2a2f36');
    const hazard = toon('#e07b39');
    const brass = toon('#c9a24a');

    this.group.add(this.kick);

    const grip = inkedMesh(geo.grip, dark, 0.014);
    grip.position.set(0, -0.11, -0.03);
    grip.rotation.x = -0.25;
    const body = inkedMesh(geo.body, steel, 0.014);
    body.position.set(0, 0.05, 0.13);
    const drum = inkedMesh(geo.drum, dark, 0.014);
    drum.rotation.x = Math.PI / 2;
    drum.position.set(0, 0.06, 0.2);
    const barrel = inkedMesh(geo.barrel, steel, 0.014);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.08, 0.47);
    const muzzle = inkedMesh(geo.muzzle, hazard, 0.014);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.08, 0.66);
    const rail = inkedMesh(geo.rail, dark, 0.01);
    rail.position.set(0, 0.165, 0.28);
    const hammer = inkedMesh(geo.hammer, dark, 0.01);
    hammer.position.set(0, 0.13, -0.06);
    hammer.rotation.x = -0.4;
    const guard = new THREE.Mesh(geo.guard, dark);
    guard.rotation.y = Math.PI / 2;
    guard.position.set(0, -0.04, 0.07);
    const bolt = new THREE.Mesh(geo.bolt, brass);
    bolt.position.set(0.09, 0.06, 0.13);

    this.kick.add(grip, body, drum, barrel, muzzle, rail, hammer, guard, bolt);
    this.muzzle.position.set(0, 0.08, 0.71);
    this.kick.add(this.muzzle);
  }

  /** 0..1 recoil amount, applied as a kick-up + slide-back. */
  setRecoil(amount: number): void {
    this.kick.rotation.x = -amount * 0.9;
    this.kick.position.z = -amount * 0.12;
  }
}
