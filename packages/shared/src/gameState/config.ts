import {
  DEFAULT_BLIND_SECONDS,
  DEFAULT_VISIBLE_SECONDS,
  MAX_BLIND_SECONDS,
  MAX_PLAYERS,
  MAX_VISIBLE_SECONDS,
  MIN_BLIND_SECONDS,
  MIN_PLAYERS,
  MIN_VISIBLE_SECONDS,
} from '../constants/game';
import { clamp } from '../math/vec';
import type { BotDifficulty, FireOrder, GameModeId, MapId, MatchConfig, PlayerStats } from '../types';

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  mode: 'FFA',
  maxPlayers: 4,
  roundsToWin: 3,
  visibleSeconds: DEFAULT_VISIBLE_SECONDS,
  blindSeconds: DEFAULT_BLIND_SECONDS,
  fireOrder: 'SEQUENTIAL',
  friendlyFire: false,
  mapId: 'TEST_CHAMBER_01',
  botDifficulty: 'NORMAL',
};

const MODES: readonly GameModeId[] = ['FFA', 'TEAMS'];
const FIRE_ORDERS: readonly FireOrder[] = ['SEQUENTIAL', 'SIMULTANEOUS'];
export const MAP_IDS: readonly MapId[] = ['TEST_CHAMBER_01', 'FACTORY_FLOOR', 'COOLING_ROOM'];
const DIFFICULTIES: readonly BotDifficulty[] = ['EASY', 'NORMAL', 'HARD'];

const pick = <T>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Validate/clamp an untrusted (possibly partial) config coming from a client. */
export function sanitizeConfig(input: unknown, base: MatchConfig = DEFAULT_MATCH_CONFIG): MatchConfig {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Partial<
    Record<keyof MatchConfig, unknown>
  >;
  const mode = pick(MODES, raw.mode, base.mode);
  let maxPlayers = Math.round(clamp(num(raw.maxPlayers, base.maxPlayers), MIN_PLAYERS, MAX_PLAYERS));
  if (mode === 'TEAMS') {
    if (maxPlayers % 2 === 1) maxPlayers = Math.min(MAX_PLAYERS, maxPlayers + 1);
    if (maxPlayers < 4) maxPlayers = 4;
  }
  return {
    mode,
    maxPlayers,
    roundsToWin: Math.round(clamp(num(raw.roundsToWin, base.roundsToWin), 1, 7)),
    visibleSeconds: clamp(num(raw.visibleSeconds, base.visibleSeconds), MIN_VISIBLE_SECONDS, MAX_VISIBLE_SECONDS),
    blindSeconds: clamp(num(raw.blindSeconds, base.blindSeconds), MIN_BLIND_SECONDS, MAX_BLIND_SECONDS),
    fireOrder: pick(FIRE_ORDERS, raw.fireOrder, base.fireOrder),
    friendlyFire: typeof raw.friendlyFire === 'boolean' ? raw.friendlyFire : base.friendlyFire,
    mapId: pick(MAP_IDS, raw.mapId, base.mapId),
    botDifficulty: pick(DIFFICULTIES, raw.botDifficulty, base.botDifficulty),
  };
}

export const emptyStats = (): PlayerStats => ({
  score: 0,
  shots: 0,
  hits: 0,
  kills: 0,
  deaths: 0,
  roundWins: 0,
  shotsSurvived: 0,
});
