/** Simulation / network rates. */
export const SIM_TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;

/** Player body + movement (metres, seconds). */
export const PLAYER_HIT_RADIUS = 0.5;
export const WALK_SPEED = 4.2;
export const SPRINT_SPEED = 6.2;
/** Keep subjects at least this far from walls when spawning. */
export const SPAWN_WALL_MARGIN = 2.2;
/** Preferred minimum distance between spawned subjects. */
export const SPAWN_SEPARATION = 7;

/** Weapon. The gun is held two-handed on the body centre line. */
export const MUZZLE_HEIGHT = 1.22;
export const MUZZLE_FORWARD = 1.15;
export const MAX_SHOT_RANGE = 60;

/** Round pacing (seconds). Visible / blind are host-configurable; the rest are fixed beats. */
export const PHASE_DURATIONS = {
  ROUND_INTRO: 1.8,
  SPAWN: 0.7,
  HIDE: 0.7,
  /** Everyone revealed and frozen, aims locked, lasers on. */
  FREEZE: 3.0,
  REVEAL: 1.6,
  ROUND_RESULTS: 3.2,
} as const;

/** Sequential shooting: delay before the first shot, gap between shots, pause after the last. */
export const SHOT_LEAD_IN = 0.35;
export const SHOT_INTERVAL = 0.85;
export const SHOT_TAIL = 1.0;
/** Simultaneous shooting: how long the volley phase lasts. */
export const SIMULTANEOUS_SHOOTING_TIME = 1.6;

export const DEFAULT_VISIBLE_SECONDS = 5;
export const DEFAULT_BLIND_SECONDS = 5;
export const DEFAULT_REPOSITION_SECONDS = 5;
export const MIN_REPOSITION_SECONDS = 2;
export const MAX_REPOSITION_SECONDS = 15;
export const MIN_VISIBLE_SECONDS = 2;
export const MAX_VISIBLE_SECONDS = 15;
export const MIN_BLIND_SECONDS = 3;
export const MAX_BLIND_SECONDS = 15;

/** A round that has not produced a winner after this many shots is a draw. */
export const MAX_SHOTS_PER_ROUND = 6;

/**
 * The arena shrinks after every volley of a round: scale = max(MIN, 1 - STEP * volleysPlayed).
 * Every new round starts back at full size.
 */
export const ARENA_SHRINK_PER_VOLLEY = 0.1;
export const MIN_ARENA_SCALE = 0.4;
export const arenaScaleForVolley = (volleysPlayed: number): number =>
  Math.max(MIN_ARENA_SCALE, 1 - ARENA_SHRINK_PER_VOLLEY * Math.max(0, volleysPlayed));

/** Selectable character looks (all original designs). */
export const SKINS = ['DUMMY', 'BLIND', 'BRAWLER', 'AGENT', 'PUNK', 'COWBOY', 'ROBOT', 'ASTRO'] as const;
export type SkinId = (typeof SKINS)[number];
export const isSkin = (v: unknown): v is SkinId => typeof v === 'string' && (SKINS as readonly string[]).includes(v);

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const SCORE = {
  HIT: 100,
  ELIMINATION: 100,
  ROUND_WIN: 200,
  SURVIVAL: 50,
} as const;

export const NAME_MAX_LENGTH = 14;
export const ROOM_CODE_LENGTH = 5;
/** No 0/O, 1/I/L, to keep codes easy to read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECONNECT_GRACE_SECONDS = 30;

/** Muted subject palette (jumpsuit colours). Index = colorIndex. */
export const SUBJECT_COLORS = [
  '#e3b23c', // yellow
  '#c8553d', // red
  '#3f7cac', // blue
  '#5c9e5a', // green
  '#e07b39', // orange
  '#8661a8', // purple
  '#4fa3a5', // teal
  '#d16f9c', // pink
] as const;

export const TEAM_COLORS = {
  1: '#3f7cac', // blue team
  2: '#e07b39', // orange team
} as const;

export const TEAM_NAMES = { 1: 'BLUE TEAM', 2: 'ORANGE TEAM' } as const;
