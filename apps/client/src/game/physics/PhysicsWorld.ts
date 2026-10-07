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

  private readonly arenaBodies: RAPIER.RigidBody[] = [];

  /** Replace only the static arena colliders (ragdolls already lying around keep going). */
  setArena(arena: ArenaDef): void {
    for (const b of this.arenaBodies) this.world.removeRigidBody(b);
    this.arenaBodies.length = 0;
    this.buildArena(arena);
  }

  private buildArena(arena: ArenaDef): void {
    const { R, world } = this;
    const fixed = (desc: RAPIER.ColliderDesc, x: number, y: number, z: number) => {
      const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
      this.arenaBodies.push(body);
      world.createCollider(desc.setFriction(0.8).setRestitution(0.15), body);
    };
    const { halfX: hx, halfZ: hz, wallHeight: h } = arena;
    // Floor (top surface at y = 0). Much bigger than the play area, so bodies left outside
    // a shrunken boundary still have ground to lie on.
    fixed(R.ColliderDesc.cuboid(120, 0.5, 120), 0, -0.5, 0);
    // Open maps have no walls: nothing to collide with at the boundary.
    if (arena.theme !== 'clean') {
      // Walls: ragdolls bounce off them.
      fixed(R.ColliderDesc.cuboid(hx + 1, h / 2, 0.5), 0, h / 2, -hz - 0.5);
      fixed(R.ColliderDesc.cuboid(hx + 1, h / 2, 0.5), 0, h / 2, hz + 0.5);
      fixed(R.ColliderDesc.cuboid(0.5, h / 2, hz + 1), -hx - 0.5, h / 2, 0);
      fixed(R.ColliderDesc.cuboid(0.5, h / 2, hz + 1), hx + 0.5, h / 2, 0);
    }
    for (const ob of arena.obstacles) {
      if (ob.kind === 'circle') fixed(R.ColliderDesc.cylinder(ob.height / 2, ob.radius), ob.pos.x, ob.height / 2, ob.pos.z);
      else fixed(R.ColliderDesc.cuboid(ob.halfX, ob.height / 2, ob.halfZ), ob.pos.x, ob.height / 2, ob.pos.z);
    }
  }

  dispose(): void {
    this.world.free();
  }
}
