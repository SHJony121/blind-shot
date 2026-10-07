import type {
  MatchConfig,
  MatchEndedEvent,
  Phase,
  PlayerInfo,
  RoundEndedEvent,
} from '@blindshot/shared';
import { Store } from './store';

export interface Banner {
  /** Changes whenever a new banner should animate in. */
  id: number;
  title: string;
  subtitle?: string;
  tone: 'neutral' | 'danger' | 'good' | 'info';
  size: 'xl' | 'lg' | 'md';
}

export interface RevealSummary {
  headline: string;
  detail?: string;
}

export interface HudState {
  active: boolean;
  online: boolean;
  localId: string;
  phase: Phase;
  round: number;
  shot: number;
  /** Seconds left in the current phase. */
  timeLeft: number;
  phaseDuration: number;
  countdown: number | null;
  roster: PlayerInfo[];
  teamWins: Record<number, number>;
  config: MatchConfig | null;
  banner: Banner | null;
  roundResult: RoundEndedEvent | null;
  matchResult: MatchEndedEvent | null;
  reveal: RevealSummary | null;
  spectating: boolean;
  paused: boolean;
  showScoreboard: boolean;
  roomCode: string | null;
  /** Incremented to trigger the full-screen gunshot flash. */
  flashId: number;
  /** Seconds since the match started (drives first-round control hints). */
  hintsVisible: boolean;
}

export const initialHud = (): HudState => ({
  active: false,
  online: false,
  localId: '',
  phase: 'WAITING',
  round: 0,
  shot: 0,
  timeLeft: 0,
  phaseDuration: 0,
  countdown: null,
  roster: [],
  teamWins: {},
  config: null,
  banner: null,
  roundResult: null,
  matchResult: null,
  reveal: null,
  spectating: false,
  paused: false,
  showScoreboard: false,
  roomCode: null,
  flashId: 0,
  hintsVisible: true,
});

export const hudStore = new Store<HudState>(initialHud());

let bannerId = 0;
export function showBanner(title: string, opts: Partial<Omit<Banner, 'id' | 'title'>> = {}): void {
  bannerId += 1;
  hudStore.set({ banner: { id: bannerId, title, tone: opts.tone ?? 'neutral', size: opts.size ?? 'xl', subtitle: opts.subtitle } });
}

export function clearBanner(): void {
  hudStore.set({ banner: null });
}
