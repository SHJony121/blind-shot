import { MAX_SHOT_RANGE, PLAYER_HIT_RADIUS } from '../constants/game';
import { rayCircle, rayCircleExit } from '../math/raycast';
import { dirToYaw, type Vec2 } from '../math/vec';
import type { MapId } from '../types';

export interface PillarDef {
  pos: Vec2;
  radius: number;
  height: number;
}

/**
 * Gameplay geometry of an arena. Everything gameplay-relevant is 2D (XZ plane):
 * shots travel horizontally at muzzle height, so circles are exact enough and
 * identical on client and server.
 */
export interface ArenaDef {
  id: MapId;
  name: string;
  /** Walkable elevated platform. */
  platformRadius: number;
  /** Low railing at the platform edge (visual + ragdoll collider; bullets fly over it). */
  railingRadius: number;
  /** Chamber wall that stops bullets and lasers. */
  wallRadius: number;
  /** Radius of the ring of spawn pads. */
  spawnRadius: number;
  pillars: PillarDef[];
}

export interface SpawnPad {
  index: number;
  pos: Vec2;
  yaw: number;
}

export interface RayTarget {
  id: string;
  pos: Vec2;
  radius?: number;
}

export interface RayHit {
  distance: number;
  end: Vec2;
  targetId: string | null;
  surface: 'WALL' | 'PILLAR' | 'SUBJECT' | 'NONE';
}

/** Evenly spaced pads around the centre; every pad faces the centre. */
export function spawnPads(arena: ArenaDef, count: number): SpawnPad[] {
  const pads: SpawnPad[] = [];
  const n = Math.max(1, count);
  // Rotate the ring for counts where a pad would otherwise sit directly behind a pillar.
  const offset = n === 8 || n === 7 ? Math.PI / n : 0;
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * Math.PI * 2;
    // Pad 0 sits at -Z (towards the default camera), then counter-clockwise.
    const pos = { x: Math.sin(a + Math.PI) * arena.spawnRadius, z: Math.cos(a + Math.PI) * arena.spawnRadius };
    pads.push({ index: i, pos, yaw: dirToYaw({ x: -pos.x, z: -pos.z }) });
  }
  return pads;
}

/**
 * Cast a horizontal ray against the arena and a list of subjects.
 * Pure function — used for authoritative shots and for client-side laser rendering.
 */
export function castRay(
  arena: ArenaDef,
  origin: Vec2,
  dir: Vec2,
  targets: readonly RayTarget[],
  maxRange = MAX_SHOT_RANGE,
): RayHit {
  let best = Math.min(maxRange, rayCircleExit(origin, dir, { x: 0, z: 0 }, arena.wallRadius));
  let surface: RayHit['surface'] = best < maxRange ? 'WALL' : 'NONE';
  let targetId: string | null = null;

  for (const p of arena.pillars) {
    const t = rayCircle(origin, dir, p.pos, p.radius);
    if (t !== null && t < best) {
      best = t;
      surface = 'PILLAR';
    }
  }
  for (const target of targets) {
    const t = rayCircle(origin, dir, target.pos, target.radius ?? PLAYER_HIT_RADIUS);
    if (t !== null && t < best) {
      best = t;
      surface = 'SUBJECT';
      targetId = target.id;
    }
  }
  return {
    distance: best,
    end: { x: origin.x + dir.x * best, z: origin.z + dir.z * best },
    targetId,
    surface,
  };
}

export const TEST_CHAMBER_01: ArenaDef = {
  id: 'TEST_CHAMBER_01',
  name: 'TEST CHAMBER 01',
  platformRadius: 9,
  railingRadius: 9.15,
  wallRadius: 14,
  spawnRadius: 6.4,
  pillars: [0, 1, 2, 3].map((i) => {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    return { pos: { x: Math.sin(a) * 3.4, z: Math.cos(a) * 3.4 }, radius: 0.55, height: 2.4 };
  }),
};

const ARENAS: Record<MapId, ArenaDef> = {
  TEST_CHAMBER_01,
};

export const getArena = (id: MapId): ArenaDef => ARENAS[id];
