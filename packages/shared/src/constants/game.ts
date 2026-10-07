/** Simulation / network rates. */
export const SIM_TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;
export const INPUT_SEND_RATE = 30;

/** Player body + movement (metres, seconds). */
export const PLAYER_HIT_RADIUS = 0.5;
export const PLAYER_HEIGHT = 2.0;
export const WALK_SPEED = 3.0;
export const SPRINT_SPEED = 4.6;
/** How far a subject may wander from the centre of their spawn pad when movement is LIGHT. */
export const PAD_MOVE_RADIUS = 1.7;

/** Weapon. The gun is held two-handed on the body centre line. */
export const MUZZLE_HEIGHT = 1.22;
export const MUZZLE_FORWARD = 1.15;
export const MAX_SHOT_RANGE = 60;

/** Round pacing (seconds). Visible / blind are host-configurable; the rest are fixed beats. */
export const PHASE_DURATIONS = {
  ROUND_INTRO: 1.8,
  SPAWN: 0.7,
  HIDE: 0.7,
  BLIND: 0.8,
  FIRE: 0.05,
  RESOLUTION: 1.5,
  REVEAL: 1.7,
  ROUND_RESULTS: 3.2,
} as const;

export const DEFAULT_VISIBLE_SECONDS = 5;
export const DEFAULT_BLIND_SECONDS = 3;
export const MIN_VISIBLE_SECONDS = 2;
export const MAX_VISIBLE_SECONDS = 10;
export const MIN_BLIND_SECONDS = 2;
export const MAX_BLIND_SECONDS = 6;

/** A round that has not produced a winner after this many shots is a draw. */
export const MAX_SHOTS_PER_ROUND = 6;

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
