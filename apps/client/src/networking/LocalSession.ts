import {
  MatchSimulation,
  SIM_TICK_RATE,
  type BotDifficulty,
  type MatchConfig,
  type PlayerInput,
  type PlayerSeed,
} from '@blindshot/shared';
import type { GameSession, SessionListener } from './GameSession';

const BOT_NAMES = ['Rivet', 'Sprocket', 'Gauge', 'Widget', 'Piston', 'Valve', 'Ratchet', 'Gizmo', 'Dial', 'Bolt', 'Flange', 'Socket'];

export interface SoloOptions {
  name: string;
  bots: number;
  difficulty: BotDifficulty;
  config: MatchConfig;
}

/** Solo play: the authoritative simulation runs right here in the browser. No server needed. */
export class LocalSession implements GameSession {
  readonly online = false;
  readonly localId = 'local';
  readonly interpolationDelay = 1.5 / SIM_TICK_RATE;
  private readonly sim: MatchSimulation;
  private listener: SessionListener | null = null;
  private accumulator = 0;
  private paused = false;

  constructor(opts: SoloOptions) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const seeds: PlayerSeed[] = [{ id: this.localId, name: opts.name, isBot: false, isHost: true }];
    for (let i = 0; i < opts.bots; i++) {
      seeds.push({ id: `bot${i + 1}`, name: names[i] ?? `Bot ${i + 1}`, isBot: true, botDifficulty: opts.difficulty });
    }
    this.sim = new MatchSimulation({ ...opts.config, maxPlayers: seeds.length, botDifficulty: opts.difficulty }, seeds);
  }

  setListener(listener: SessionListener): void {
    this.listener = listener;
    this.sim.start();
    this.flush();
  }

  sendInput(input: PlayerInput): void {
    this.sim.queueInput(this.localId, input);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  update(dt: number): void {
    if (this.paused || !this.listener) return;
    const step = 1 / SIM_TICK_RATE;
    this.accumulator += dt;
    let ticked = false;
    while (this.accumulator >= step) {
      this.accumulator -= step;
      this.sim.tick(step);
      for (const e of this.sim.drainEvents()) this.listener.onEvent(e);
      ticked = true;
    }
    if (ticked) this.flush();
  }

  dispose(): void {
    this.listener = null;
  }

  private flush(): void {
    this.listener?.onView(this.sim.buildView(this.localId));
  }
}
