import { resolveCollisions, type ArenaDef } from '../arena/arena';
import { PLAYER_HIT_RADIUS, SPRINT_SPEED, WALK_SPEED } from '../constants/game';
import { wrapAngle, type Vec2 } from '../math/vec';
import type { PlayerInput } from '../types';

/** Clamp and clean an untrusted input. Returns null when the payload is malformed. */
export function sanitizeInput(raw: unknown): PlayerInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const seq = n(r.seq);
  const moveX = n(r.moveX);
  const moveZ = n(r.moveZ);
  const yaw = n(r.yaw);
  if (seq === null || moveX === null || moveZ === null || yaw === null) return null;
  const len = Math.hypot(moveX, moveZ);
  const k = len > 1 ? 1 / len : 1;
  return { seq: Math.floor(seq), moveX: moveX * k, moveZ: moveZ * k, sprint: r.sprint === true, yaw: wrapAngle(yaw) };
}

/**
 * Deterministic arcade movement shared by the authority and client-side prediction.
 * Subjects can go anywhere on the floor; obstacles and walls block them (floating maps have no walls).
 */
export function stepMovement(
  pos: Vec2,
  input: Pick<PlayerInput, 'moveX' | 'moveZ' | 'sprint'>,
  dt: number,
  arena: ArenaDef,
): Vec2 {
  const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
  const next = { x: pos.x + input.moveX * speed * dt, z: pos.z + input.moveZ * speed * dt };
  // On floating platforms nothing stops you at the edge: step past it and you fall.
  return resolveCollisions(arena, next, PLAYER_HIT_RADIUS, !arena.floating);
}
