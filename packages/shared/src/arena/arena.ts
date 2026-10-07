import { MAX_SHOT_RANGE, PLAYER_HIT_RADIUS, SPAWN_SEPARATION, SPAWN_WALL_MARGIN } from '../constants/game';
import { rayCircle } from '../math/raycast';
import { dirToYaw, type Vec2 } from '../math/vec';
import type { Rng } from '../util/rng';
import type { MapId, TeamId } from '../types';

export interface CircleObstacle {
  kind: 'circle';
  pos: Vec2;
  radius: number;
  height: number;
}

/** Axis-aligned box obstacle (half extents on X/Z). */
export interface BoxObstacle {
  kind: 'box';
  pos: Vec2;
  halfX: number;
  halfZ: number;
  height: number;
}

export type Obstacle = CircleObstacle | BoxObstacle;

export type ArenaTheme = 'clean' | 'chamber' | 'factory' | 'cooling';

/**
 * Gameplay geometry of an arena. Everything gameplay-relevant is 2D (XZ plane):
 * shots travel horizontally at muzzle height, so this is exact enough and identical
 * on client and server. Arenas are open rectangles; subjects can stand anywhere.
 */
export interface ArenaDef {
  id: MapId;
  name: string;
  theme: ArenaTheme;
  /** Walkable floor is [-halfX, halfX] × [-halfZ, halfZ]; walls stop bullets at the edge. */
  halfX: number;
  halfZ: number;
  wallHeight: number;
  obstacles: Obstacle[];
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
  /** Surface normal at the hit point (XZ). */
  normal: Vec2;
}

/** Ray (origin inside) against the arena's outer walls: distance to the exit point. */
function rayWalls(arena: ArenaDef, o: Vec2, d: Vec2): { t: number; normal: Vec2 } {
  let t = Infinity;
  let normal: Vec2 = { x: 0, z: 0 };
  if (d.x > 1e-9) {
    const tx = (arena.halfX - o.x) / d.x;
    if (tx < t) [t, normal] = [tx, { x: -1, z: 0 }];
  } else if (d.x < -1e-9) {
    const tx = (-arena.halfX - o.x) / d.x;
    if (tx < t) [t, normal] = [tx, { x: 1, z: 0 }];
  }
  if (d.z > 1e-9) {
    const tz = (arena.halfZ - o.z) / d.z;
    if (tz < t) [t, normal] = [tz, { x: 0, z: -1 }];
  } else if (d.z < -1e-9) {
    const tz = (-arena.halfZ - o.z) / d.z;
    if (tz < t) [t, normal] = [tz, { x: 0, z: 1 }];
  }
  return { t: Math.max(0, t), normal };
}

/** Ray against an axis-aligned box (slab method). Null when it misses or the box is behind. */
function rayBox(o: Vec2, d: Vec2, b: BoxObstacle): { t: number; normal: Vec2 } | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  let normal: Vec2 = { x: 0, z: 0 };
  for (const axis of ['x', 'z'] as const) {
    const half = axis === 'x' ? b.halfX : b.halfZ;
    const lo = b.pos[axis] - half;
    const hi = b.pos[axis] + half;
    if (Math.abs(d[axis]) < 1e-9) {
      if (o[axis] < lo || o[axis] > hi) return null;
      continue;
    }
    let t1 = (lo - o[axis]) / d[axis];
    let t2 = (hi - o[axis]) / d[axis];
    let sign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      normal = axis === 'x' ? { x: sign, z: 0 } : { x: 0, z: sign };
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), normal };
}

/**
 * Cast a horizontal ray against the arena (walls + obstacles) and a list of subjects.
 * Pure — used for authoritative shots and for client-side laser rendering.
 */
export function castRay(
  arena: ArenaDef,
  origin: Vec2,
  dir: Vec2,
  targets: readonly RayTarget[],
  maxRange = MAX_SHOT_RANGE,
): RayHit {
  const wall = rayWalls(arena, origin, dir);
  let best = Math.min(maxRange, wall.t);
  let surface: RayHit['surface'] = best < maxRange ? 'WALL' : 'NONE';
  let normal = wall.normal;
  let targetId: string | null = null;

  for (const ob of arena.obstacles) {
    if (ob.kind === 'circle') {
      const t = rayCircle(origin, dir, ob.pos, ob.radius);
      if (t !== null && t < best) {
        best = t;
        surface = 'PILLAR';
        const hx = origin.x + dir.x * t - ob.pos.x;
        const hz = origin.z + dir.z * t - ob.pos.z;
        const l = Math.hypot(hx, hz) || 1;
        normal = { x: hx / l, z: hz / l };
      }
    } else {
      const hit = rayBox(origin, dir, ob);
      if (hit && hit.t < best) {
        best = hit.t;
        surface = 'PILLAR';
        normal = hit.normal;
      }
    }
  }
  for (const target of targets) {
    const t = rayCircle(origin, dir, target.pos, target.radius ?? PLAYER_HIT_RADIUS);
    if (t !== null && t < best) {
      best = t;
      surface = 'SUBJECT';
      targetId = target.id;
      normal = { x: -dir.x, z: -dir.z };
    }
  }
  return {
    distance: best,
    end: { x: origin.x + dir.x * best, z: origin.z + dir.z * best },
    targetId,
    surface,
    normal,
  };
}

/** Push a circle of `radius` at `p` out of every obstacle and back inside the walls. */
export function resolveCollisions(arena: ArenaDef, p: Vec2, radius: number): Vec2 {
  let { x, z } = p;
  for (const ob of arena.obstacles) {
    if (ob.kind === 'circle') {
      const dx = x - ob.pos.x;
      const dz = z - ob.pos.z;
      const d = Math.hypot(dx, dz);
      const min = ob.radius + radius;
      if (d < min && d > 1e-6) {
        x = ob.pos.x + (dx / d) * min;
        z = ob.pos.z + (dz / d) * min;
      }
    } else {
      const cx = Math.max(ob.pos.x - ob.halfX, Math.min(x, ob.pos.x + ob.halfX));
      const cz = Math.max(ob.pos.z - ob.halfZ, Math.min(z, ob.pos.z + ob.halfZ));
      const dx = x - cx;
      const dz = z - cz;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        if (d > 1e-6) {
          x = cx + (dx / d) * radius;
          z = cz + (dz / d) * radius;
        } else {
          // Centre inside the box: push out along the shallowest axis.
          const px = ob.halfX - Math.abs(x - ob.pos.x);
          const pz = ob.halfZ - Math.abs(z - ob.pos.z);
          if (px < pz) x = ob.pos.x + Math.sign(x - ob.pos.x || 1) * (ob.halfX + radius);
          else z = ob.pos.z + Math.sign(z - ob.pos.z || 1) * (ob.halfZ + radius);
        }
      }
    }
  }
  x = Math.max(-arena.halfX + radius, Math.min(arena.halfX - radius, x));
  z = Math.max(-arena.halfZ + radius, Math.min(arena.halfZ - radius, z));
  return { x, z };
}

function clearOfObstacles(arena: ArenaDef, p: Vec2, clearance: number): boolean {
  return arena.obstacles.every((ob) => {
    if (ob.kind === 'circle') return Math.hypot(p.x - ob.pos.x, p.z - ob.pos.z) > ob.radius + clearance;
    return Math.abs(p.x - ob.pos.x) > ob.halfX + clearance || Math.abs(p.z - ob.pos.z) > ob.halfZ + clearance;
  });
}

export interface SpawnPoint {
  pos: Vec2;
  yaw: number;
}

/**
 * Random, well-separated spawn points anywhere on the floor. In TEAMS mode team 1 spawns
 * on the -X half and team 2 on the +X half. Everyone initially faces the arena centre.
 */
export function randomSpawns(arena: ArenaDef, teams: readonly TeamId[], rng: Rng): SpawnPoint[] {
  const placed: Vec2[] = [];
  const out: SpawnPoint[] = [];
  const mx = arena.halfX - SPAWN_WALL_MARGIN;
  const mz = arena.halfZ - SPAWN_WALL_MARGIN;
  for (const team of teams) {
    let best: Vec2 = { x: 0, z: 0 };
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 80; attempt++) {
      let x = rng.range(-mx, mx);
      if (team === 1) x = -Math.abs(x) * 0.85 - 1;
      if (team === 2) x = Math.abs(x) * 0.85 + 1;
      const p = { x, z: rng.range(-mz, mz) };
      if (!clearOfObstacles(arena, p, 1.2)) continue;
      const nearest = placed.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.z - q.z)), Infinity);
      if (nearest >= SPAWN_SEPARATION) {
        best = p;
        bestScore = Infinity;
        break;
      }
      if (nearest > bestScore) {
        best = p;
        bestScore = nearest;
      }
    }
    placed.push(best);
    const toCentre = { x: -best.x, z: -best.z };
    out.push({ pos: best, yaw: Math.hypot(toCentre.x, toCentre.z) > 0.1 ? dirToYaw(toCentre) : 0 });
  }
  return out;
}

const circle = (x: number, z: number, radius: number, height = 3): CircleObstacle => ({
  kind: 'circle',
  pos: { x, z },
  radius,
  height,
});
const box = (x: number, z: number, halfX: number, halfZ: number, height = 2.2): BoxObstacle => ({
  kind: 'box',
  pos: { x, z },
  halfX,
  halfZ,
  height,
});

/** Big open square test floor with four pillars and two low blocks for cover. */
export const TEST_CHAMBER_01: ArenaDef = {
  id: 'TEST_CHAMBER_01',
  name: 'TEST CHAMBER 01',
  theme: 'chamber',
  halfX: 14,
  halfZ: 14,
  wallHeight: 9,
  obstacles: [
    circle(-6, -6, 0.75),
    circle(6, -6, 0.75),
    circle(-6, 6, 0.75),
    circle(6, 6, 0.75),
    box(0, -9.5, 1.6, 0.6, 1.6),
    box(0, 9.5, 1.6, 0.6, 1.6),
  ],
};

/** Long factory hall with crates and machinery to hide behind. */
export const FACTORY_FLOOR: ArenaDef = {
  id: 'FACTORY_FLOOR',
  name: 'FACTORY FLOOR',
  theme: 'factory',
  halfX: 18,
  halfZ: 13,
  wallHeight: 10,
  obstacles: [
    box(-9, 5, 1.2, 1.2),
    box(-6.6, 5, 1.0, 1.0, 1.6),
    box(8, -5, 1.5, 1.1),
    box(0, 0, 3.6, 0.7, 1.3),
    box(-4, -8, 1.1, 1.1),
    box(11, 7, 1.0, 1.6),
    box(4, 8.5, 0.9, 0.9, 1.6),
    circle(-13, -3, 0.8, 6),
    circle(13.5, -1, 0.8, 6),
  ],
};

/** Square reactor cooling room: big round tanks and a central core. */
export const COOLING_ROOM: ArenaDef = {
  id: 'COOLING_ROOM',
  name: 'COOLING ROOM',
  theme: 'cooling',
  halfX: 15,
  halfZ: 15,
  wallHeight: 10,
  obstacles: [
    circle(0, 0, 2.1, 5),
    circle(-8.5, -8.5, 1.5, 4),
    circle(8.5, 8.5, 1.5, 4),
    circle(-8.5, 8.5, 1.1, 3.5),
    circle(8.5, -8.5, 1.1, 3.5),
    box(-11.5, 0, 0.6, 2.2, 1.4),
    box(11.5, 0, 0.6, 2.2, 1.4),
  ],
};

/** Bright, clean white test floor under an open sky: the classic look. */
export const WHITE_ROOM: ArenaDef = {
  id: 'WHITE_ROOM',
  name: 'WHITE ROOM',
  theme: 'clean',
  halfX: 16,
  halfZ: 16,
  wallHeight: 2.2,
  obstacles: [
    box(-7, -4, 1.0, 1.0, 1.8),
    box(7, 4, 1.0, 1.0, 1.8),
    box(-3, 8, 2.2, 0.5, 1.6),
    box(3, -8, 2.2, 0.5, 1.6),
    circle(9, -9, 0.7, 2.6),
    circle(-9, 9, 0.7, 2.6),
  ],
};

export const ARENAS: Record<MapId, ArenaDef> = {
  WHITE_ROOM,
  TEST_CHAMBER_01,
  FACTORY_FLOOR,
  COOLING_ROOM,
};

export const getArena = (id: MapId): ArenaDef => ARENAS[id] ?? WHITE_ROOM;

/**
 * The arena for a given shrink scale: walls move in, obstacle layout scales with them,
 * obstacle sizes stay the same. Obstacles that would no longer fit are dropped.
 */
export function scaleArena(def: ArenaDef, scale: number): ArenaDef {
  if (scale >= 0.999) return def;
  const halfX = def.halfX * scale;
  const halfZ = def.halfZ * scale;
  const obstacles = def.obstacles
    .map((o) => ({ ...o, pos: { x: o.pos.x * scale, z: o.pos.z * scale } }))
    .filter((o) => {
      const ex = o.kind === 'circle' ? o.radius : o.halfX;
      const ez = o.kind === 'circle' ? o.radius : o.halfZ;
      return Math.abs(o.pos.x) + ex < halfX - 1.5 && Math.abs(o.pos.z) + ez < halfZ - 1.5;
    });
  return { ...def, halfX, halfZ, obstacles };
}
