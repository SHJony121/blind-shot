import type { Vec2 } from './vec';

/**
 * Distance along a normalised 2D ray to the first intersection with a circle,
 * or null when it misses / the circle is behind the origin.
 * If the origin is inside the circle the ray counts as hitting at t = 0.
 */
export function rayCircle(origin: Vec2, dir: Vec2, center: Vec2, radius: number): number | null {
  const ox = origin.x - center.x;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oz * dir.z;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  if (b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  return -b - Math.sqrt(disc);
}

