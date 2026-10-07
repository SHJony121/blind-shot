import {
  MatchSimulation,
  SIM_TICK_RATE,
  SNAPSHOT_RATE,
  type MatchConfig,
  type MatchEvent,
  type PlayerInput,
  type PlayerSeed,
} from '@blindshot/shared';
import type { BlindShotServer } from '../networking/types';

/** Seconds the final results stay up before the room returns to its lobby. */
const RESULTS_HOLD_SECONDS = 2;

/**
 * Drives one authoritative MatchSimulation for a room: fixed 30 Hz ticks, per-player
 * filtered snapshots at 20 Hz, and discrete events broadcast to the room.
 */
export class MatchRunner {
  readonly sim: MatchSimulation;
  private timer: NodeJS.Timeout | null = null;
  private snapshotAcc = 0;
  private finishedFor = 0;
  private lastTick = 0;
  private tickDebt = 0;

  constructor(
    private readonly io: BlindShotServer,
    private readonly channel: string,
    config: MatchConfig,
    seeds: PlayerSeed[],
    /** Returns the socket id currently bound to a player (null when disconnected). */
    private readonly socketOf: (playerId: string) => string | null,
    /** Every member who should receive snapshots (participants + spectators). */
    private readonly audience: () => string[],
    private readonly onFinished: () => void,
  ) {
    this.sim = new MatchSimulation(config, seeds);
  }

  start(): void {
    this.sim.start();
    this.flushEvents();
    for (const id of this.audience()) {
      const sid = this.socketOf(id);
      if (sid) this.io.to(sid).emit('matchStarted', this.sim.buildView(id));
    }
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.loop(), 1000 / SIM_TICK_RATE);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  queueInput(playerId: string, input: PlayerInput): void {
    this.sim.queueInput(playerId, input);
  }

  /** Bring a (re)connecting member into the running match view. */
  sendJoin(playerId: string): void {
    const sid = this.socketOf(playerId);
    if (sid) this.io.to(sid).emit('matchStarted', this.sim.buildView(playerId));
  }

  private loop(): void {
    // setInterval drifts; catch up with fixed steps so game time tracks wall time.
    const now = performance.now();
    this.tickDebt += (now - this.lastTick) / 1000;
    this.lastTick = now;
    const step = 1 / SIM_TICK_RATE;
    let steps = 0;
    while (this.tickDebt >= step && steps < 5) {
      this.tickDebt -= step;
      steps++;
      this.sim.tick(step);
      const hadEvents = this.flushEvents();
      this.snapshotAcc += step;
      if (hadEvents || this.snapshotAcc >= 1 / SNAPSHOT_RATE) {
        this.snapshotAcc = 0;
        this.broadcastSnapshots();
      }
    }
    if (steps === 5) this.tickDebt = 0;

    if (this.sim.finished) {
      this.finishedFor += steps * step;
      if (this.finishedFor >= RESULTS_HOLD_SECONDS) {
        this.stop();
        this.onFinished();
      }
    }
  }

  private flushEvents(): boolean {
    const events: MatchEvent[] = this.sim.drainEvents();
    for (const e of events) {
      // Events contain no hidden information: the shootout is the reveal itself.
      this.io.to(this.channel).emit(e.type, e.data as never);
    }
    return events.length > 0;
  }

  private broadcastSnapshots(): void {
    for (const id of this.audience()) {
      const sid = this.socketOf(id);
      if (!sid) continue;
      // Each viewer gets a view filtered for them: hidden enemies are simply not in it.
      this.io.to(sid).volatile.emit('snapshot', this.sim.buildView(id));
    }
  }
}
