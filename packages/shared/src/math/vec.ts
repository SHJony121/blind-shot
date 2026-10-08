export interface Vec2 {
  x: number;
  z: number;
}

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const length = (a: Vec2): number => Math.hypot(a.x, a.z);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const normalize = (a: Vec2): Vec2 => {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Yaw convention (shared by sim and renderer):
 * yaw = 0 faces +Z, yaw = PI/2 faces +X. Matches Three.js `object.rotation.y`.
 */
export const yawToDir = (yaw: number): Vec2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
export const dirToYaw = (d: Vec2): number => Math.atan2(d.x, d.z);

export const wrapAngle = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
};

export const angleDiff = (from: number, to: number): number => wrapAngle(to - from);

/** Rotate `current` toward `target` by at most `maxStep` radians. */
export const turnToward = (current: number, target: number, maxStep: number): number => {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(d) * maxStep);
};

