import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { SubjectModel, SubjectPartName } from './SubjectModel';

interface PartSpec {
  parent: SubjectPartName | null;
  /** Collider in the part's local frame. */
  shape: 'ball' | 'capsule';
  radius: number;
  halfHeight?: number;
  offset: [number, number, number];
  density: number;
}

const SPECS: Record<SubjectPartName, PartSpec> = {
  hips: { parent: null, shape: 'ball', radius: 0.3, offset: [0, 0, 0], density: 1.4 },
  torso: { parent: 'hips', shape: 'capsule', radius: 0.34, halfHeight: 0.16, offset: [0, 0.38, 0], density: 1.1 },
  head: { parent: 'torso', shape: 'ball', radius: 0.4, offset: [0, 0.33, 0], density: 0.6 },
  armL: { parent: 'torso', shape: 'capsule', radius: 0.11, halfHeight: 0.18, offset: [0, -0.3, 0], density: 1 },
  armR: { parent: 'torso', shape: 'capsule', radius: 0.11, halfHeight: 0.18, offset: [0, -0.3, 0], density: 1 },
  legL: { parent: 'hips', shape: 'capsule', radius: 0.14, halfHeight: 0.2, offset: [0, -0.33, 0], density: 1.2 },
  legR: { parent: 'hips', shape: 'capsule', radius: 0.14, halfHeight: 0.2, offset: [0, -0.33, 0], density: 1.2 },
};

const ORDER: SubjectPartName[] = ['hips', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'];

const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const m = new THREE.Matrix4();

/**
 * Converts a SubjectModel into a floppy physics ragdoll (Rapier) at the moment of death.
 * Each body part becomes a rigid body connected by ball joints; the gun flies off on
 * its own. Pure presentation — the gameplay result was already decided by the authority.
 */
export class Ragdoll {
  private readonly bodies = new Map<SubjectPartName, RAPIER.RigidBody>();
  private readonly gunBody: RAPIER.RigidBody;
  private readonly scene: THREE.Object3D;
  private sleepTimer = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly model: SubjectModel,
    impulseDir: THREE.Vector3,
    strength = 1,
  ) {
    const { R, world } = physics;
    this.scene = model.root.parent ?? model.root;
    model.root.updateMatrixWorld(true);

    // Capture world transforms before re-parenting anything.
    const worldMats = new Map<SubjectPartName, THREE.Matrix4>();
    for (const name of ORDER) worldMats.set(name, model.parts[name].matrixWorld.clone());

    for (const name of ORDER) {
      const spec = SPECS[name];
      const mat = worldMats.get(name)!;
      mat.decompose(v, q, s);
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(v.x, v.y, v.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinearDamping(0.15)
          .setAngularDamping(0.8)
          .setCcdEnabled(true),
      );
      const desc =
        spec.shape === 'ball' ? R.ColliderDesc.ball(spec.radius) : R.ColliderDesc.capsule(spec.halfHeight ?? 0.2, spec.radius);
      desc
        .setTranslation(...spec.offset)
        .setDensity(spec.density)
        .setFriction(0.9)
        .setRestitution(0.2)
        // Parts of the same ragdoll don't collide with each other (group 1 vs others).
        .setCollisionGroups(0x0002_fffd);
      world.createCollider(desc, body);
      this.bodies.set(name, body);

      if (spec.parent) {
        const parentBody = this.bodies.get(spec.parent)!;
        const parentMat = worldMats.get(spec.parent)!;
        // Joint anchor = this part's origin, expressed in the parent's local frame.
        const inv = m.copy(parentMat).invert();
        const anchor = v.setFromMatrixPosition(mat).applyMatrix4(inv);
        const parentScale = new THREE.Vector3().setFromMatrixScale(parentMat);
        anchor.multiply(parentScale);
        const joint = R.JointData.spherical({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: 0, y: 0, z: 0 });
        world.createImpulseJoint(joint, parentBody, body, true);
      }
    }

    // Re-parent parts to the scene so they can be driven by physics directly.
    for (const name of ORDER) {
      const part = model.parts[name];
      this.scene.attach(part);
      part.scale.set(1, 1, 1);
    }

    // The gun flies off.
    const gun = model.gun.group;
    gun.updateMatrixWorld(true);
    gun.matrixWorld.decompose(v, q, s);
    this.scene.attach(gun);
    this.gunBody = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(v.x, v.y, v.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setAngularDamping(0.4)
        .setCcdEnabled(true),
    );
    world.createCollider(R.ColliderDesc.cuboid(0.09, 0.12, 0.35).setTranslation(0, 0, 0.3).setDensity(0.8).setRestitution(0.35), this.gunBody);

    // Kick: mostly along the bullet, a bit upward, plus a comedic spin.
    const dir = impulseDir.clone().setY(0).normalize();
    // Total ragdoll mass is roughly 1 kg, so these impulses mean ~3-4 m/s of knock-back.
    const k = 2.2 * strength;
    const torso = this.bodies.get('torso')!;
    torso.applyImpulse({ x: dir.x * k, y: 0.9 * strength, z: dir.z * k }, true);
    this.bodies.get('head')!.applyImpulse({ x: dir.x * k * 0.25, y: 0.2, z: dir.z * k * 0.25 }, true);
    torso.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.25, y: (Math.random() - 0.5) * 0.4, z: (Math.random() - 0.5) * 0.25 }, true);
    this.gunBody.applyImpulse({ x: dir.x * 0.25 + (Math.random() - 0.5) * 0.2, y: 0.55, z: dir.z * 0.25 + (Math.random() - 0.5) * 0.2 }, true);
    this.gunBody.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.03, y: (Math.random() - 0.5) * 0.03, z: (Math.random() - 0.5) * 0.03 }, true);
  }

  /** Copy physics transforms back onto the meshes. */
  update(dt: number): void {
    for (const [name, body] of this.bodies) this.sync(this.model.parts[name], body);
    this.sync(this.model.gun.group, this.gunBody);
    this.sleepTimer += dt;
  }

  dispose(): void {
    const world = this.physics.world;
    for (const body of this.bodies.values()) world.removeRigidBody(body);
    world.removeRigidBody(this.gunBody);
    this.bodies.clear();
  }

  private sync(obj: THREE.Object3D, body: RAPIER.RigidBody): void {
    const t = body.translation();
    const r = body.rotation();
    obj.position.set(t.x, t.y, t.z);
    obj.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
