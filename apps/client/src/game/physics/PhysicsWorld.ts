import RAPIER from '@dimforge/rapier3d-compat';
import type { ArenaDef } from '@blindshot/shared';

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  rapierReady ??= RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

/**
 * Client-side physics used for presentation only (ragdolls, flying guns).
 * Gameplay hit detection never depends on it — that is the shared analytic raycast.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private accumulator = 0;
  private static readonly STEP = 1 / 60;

  constructor(
    readonly R: Rapier,
    arena: ArenaDef,
  ) {
    this.world = new R.World({ x: 0, y: -14, z: 0 });
    this.world.timestep = PhysicsWorld.STEP;
    this.buildArena(arena);
  }

  step(dt: number): void {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PhysicsWorld.STEP && steps < 4) {
      this.world.step();
      this.accumulator -= PhysicsWorld.STEP;
      steps++;
    }
    if (steps === 4) this.accumulator = 0;
  }

  private buildArena(arena: ArenaDef): void {
    const { R, world } = this;
    const fixed = (desc: RAPIER.ColliderDesc, x: number, y: number, z: number, rotY = 0) => {
      const body = world.createRigidBody(
        R.RigidBodyDesc.fixed()
          .setTranslation(x, y, z)
          .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) }),
      );
      world.createCollider(desc.setFriction(0.8).setRestitution(0.15), body);
    };

    // Elevated platform (top surface at y = 0).
    fixed(R.ColliderDesc.cylinder(0.3, arena.platformRadius), 0, -0.3, 0);
    // Pit floor far below — bodies that fly off the edge land here.
    fixed(R.ColliderDesc.cuboid(40, 0.5, 40), 0, -7.5, 0);
    // Pillars.
    for (const p of arena.pillars) fixed(R.ColliderDesc.cylinder(p.height / 2, p.radius), p.pos.x, p.height / 2, p.pos.z);
    // Low railing: a ring of thin boxes so ragdolls can tumble over it.
    const segments = 36;
    const r = arena.railingRadius;
    const half = Math.PI * r / segments;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      fixed(R.ColliderDesc.cuboid(half, 0.5, 0.04), Math.sin(a) * r, 0.5, Math.cos(a) * r, a);
    }
    // Chamber wall (outer), approximated by boxes.
    const wr = arena.wallRadius;
    const wh = Math.PI * wr / segments;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      fixed(R.ColliderDesc.cuboid(wh, 10, 0.3), Math.sin(a) * (wr + 0.3), 2, Math.cos(a) * (wr + 0.3), a);
    }
  }
}
