import { castRay, type ArenaDef, type RayTarget } from '../arena/arena';
import { MUZZLE_FORWARD } from '../constants/game';
import { yawToDir, type Vec2 } from '../math/vec';
import type { ShotResult, TeamId } from '../types';

export interface ShooterSnapshot {
  id: string;
  team: TeamId;
  pos: Vec2;
  yaw: number;
}

export const muzzleOrigin = (pos: Vec2, yaw: number): Vec2 => {
  const d = yawToDir(yaw);
  return { x: pos.x + d.x * MUZZLE_FORWARD, z: pos.z + d.z * MUZZLE_FORWARD };
};

/**
 * STEP 1 — compute every shot from one frozen snapshot. Pure: modifies nothing.
 * Every subject in `snapshot` fires and every subject in `snapshot` can be hit,
 * regardless of whether another bullet in this same volley also hits them.
 */
export function computeShots(arena: ArenaDef, snapshot: readonly ShooterSnapshot[], friendlyFire: boolean): ShotResult[] {
  return snapshot.map((shooter) => fireOne(arena, shooter, snapshot, friendlyFire));
}

/** Resolve one shooter's bullet against a set of (alive) subjects. Pure. */
export function fireOne(
  arena: ArenaDef,
  shooter: ShooterSnapshot,
  subjects: readonly ShooterSnapshot[],
  friendlyFire: boolean,
): ShotResult {
  const origin = muzzleOrigin(shooter.pos, shooter.yaw);
  const dir = yawToDir(shooter.yaw);
  const targets: RayTarget[] = subjects
    .filter((t) => t.id !== shooter.id && (friendlyFire || shooter.team === 0 || t.team !== shooter.team))
    .map((t) => ({ id: t.id, pos: t.pos }));
  const hit = castRay(arena, origin, dir, targets);
  return {
    shooterId: shooter.id,
    origin,
    dir,
    end: hit.end,
    distance: hit.distance,
    hitPlayerId: hit.targetId,
    hitZone: hit.targetId ? 'BODY' : null,
    hitSurface: hit.surface,
    normal: hit.normal,
  };
}

/**
 * STEP 2 — the set of eliminated subjects, applied simultaneously by the caller.
 * Order-independent by construction: a subject hit in this volley still fired.
 */
export function collectEliminations(shots: readonly ShotResult[]): string[] {
  const out = new Set<string>();
  for (const s of shots) if (s.hitPlayerId) out.add(s.hitPlayerId);
  return [...out];
}
