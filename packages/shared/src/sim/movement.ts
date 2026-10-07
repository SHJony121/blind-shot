import type { ArenaDef } from '../arena/arena';
import { PAD_MOVE_RADIUS, PLAYER_HIT_RADIUS, SPRINT_SPEED, WALK_SPEED } from '../constants/game';
import { wrapAngle, type Vec2 } from '../math/vec';
import type { MovementMode, PlayerInput } from '../types';

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
 * No acceleration: subjects respond instantly, which keeps aiming readable.
 */
export function stepMovement(
  pos: Vec2,
  input: Pick<PlayerInput, 'moveX' | 'moveZ' | 'sprint'>,
  dt: number,
  padCenter: Vec2,
  movement: MovementMode,
  arena: ArenaDef,
): Vec2 {
  if (movement === 'FIXED') return { x: padCenter.x, z: padCenter.z };
  const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
  let x = pos.x + input.moveX * speed * dt;
  let z = pos.z + input.moveZ * speed * dt;

  // Stay inside the pad's area.
  const dx = x - padCenter.x;
  const dz = z - padCenter.z;
  const d = Math.hypot(dx, dz);
  if (d > PAD_MOVE_RADIUS) {
    x = padCenter.x + (dx / d) * PAD_MOVE_RADIUS;
    z = padCenter.z + (dz / d) * PAD_MOVE_RADIUS;
  }

  // Push out of pillars.
  for (const p of arena.pillars) {
    const px = x - p.pos.x;
    const pz = z - p.pos.z;
    const pd = Math.hypot(px, pz);
    const min = p.radius + PLAYER_HIT_RADIUS;
    if (pd < min && pd > 1e-6) {
      x = p.pos.x + (px / pd) * min;
      z = p.pos.z + (pz / pd) * min;
    }
  }

  // Stay on the platform.
  const r = Math.hypot(x, z);
  const maxR = arena.platformRadius - PLAYER_HIT_RADIUS;
  if (r > maxR) {
    x = (x / r) * maxR;
    z = (z / r) * maxR;
  }
  return { x, z };
}
