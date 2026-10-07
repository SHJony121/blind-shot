import {
  DEFAULT_MATCH_CONFIG,
  MIN_PLAYERS,
  RECONNECT_GRACE_SECONDS,
  sanitizeConfig,
  type MatchConfig,
  type PlayerInput,
  type PlayerSeed,
  type RoomMember,
  type RoomState,
  type RoomVisibility,
  type TeamId,
} from '@blindshot/shared';
import { MatchRunner } from '../game/MatchRunner';
import type { BlindShotServer } from '../networking/types';

interface Member {
  id: string;
  name: string;
  ready: boolean;
  socketId: string | null;
  team: TeamId;
  joinedAt: number;
  dropTimer: NodeJS.Timeout | null;
}

const BOT_NAMES = ['Rivet', 'Sprocket', 'Gauge', 'Widget', 'Piston', 'Valve', 'Ratchet', 'Gizmo'];

/**
 * A lobby + (optionally) a running match. The room is the unit of authority: it owns the
 * MatchRunner, decides who is host, and survives disconnects for a grace period.
 */
export class Room {
  hostId: string;
  config: MatchConfig;
  botFill = 0;
  private readonly members = new Map<string, Member>();
  private runner: MatchRunner | null = null;

  constructor(
    private readonly io: BlindShotServer,
    readonly code: string,
    readonly visibility: RoomVisibility,
    hostId: string,
    config: Partial<MatchConfig> = {},
    private readonly onEmpty: (room: Room) => void,
  ) {
    this.hostId = hostId;
    this.config = sanitizeConfig(config, DEFAULT_MATCH_CONFIG);
    if (visibility === 'PUBLIC') this.botFill = 0;
  }

  get channel(): string {
    return `room:${this.code}`;
  }

  get inMatch(): boolean {
    return this.runner !== null;
  }

  get humanCount(): number {
    return this.members.size;
  }

  hasMember(id: string): boolean {
    return this.members.has(id);
  }

  hasOpenSlot(): boolean {
    return this.members.size < this.config.maxPlayers;
  }

  // --- Membership --------------------------------------------------------------

  join(id: string, name: string, socketId: string): void {
    const existing = this.members.get(id);
    if (existing) {
      this.reconnect(id, socketId, name);
      return;
    }
    this.members.set(id, { id, name, ready: false, socketId, team: this.nextTeam(), joinedAt: Date.now(), dropTimer: null });
    this.io.in(socketId).socketsJoin(this.channel);
    this.clampBots();
    this.broadcastState();
    this.notice(`${name.toUpperCase()} JOINED`);
  }

  reconnect(id: string, socketId: string, name?: string): void {
    const m = this.members.get(id);
    if (!m) return;
    if (m.dropTimer) clearTimeout(m.dropTimer);
    m.dropTimer = null;
    m.socketId = socketId;
    if (name) m.name = name;
    this.io.in(socketId).socketsJoin(this.channel);
    this.runner?.sim.setConnected(id, true);
    this.broadcastState();
    this.runner?.sendJoin(id);
  }

  /** Socket dropped: keep the seat for a grace period. */
  disconnect(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    m.socketId = null;
    this.runner?.sim.setConnected(id, false);
    if (this.hostId === id) this.transferHost();
    m.dropTimer = setTimeout(() => this.leave(id), RECONNECT_GRACE_SECONDS * 1000);
    this.broadcastState();
    if (!this.anyConnected()) {
      // Nobody left watching: stop simulating, but keep seats until the grace period ends.
      this.runner?.stop();
      this.runner = null;
    }
  }

  leave(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    if (m.dropTimer) clearTimeout(m.dropTimer);
    if (m.socketId) this.io.in(m.socketId).socketsLeave(this.channel);
    this.members.delete(id);
    this.runner?.sim.setConnected(id, false);
    if (this.members.size === 0) {
      this.close();
      return;
    }
    if (this.hostId === id) this.transferHost();
    this.clampBots();
    this.broadcastState();
    this.notice(`${m.name.toUpperCase()} LEFT`);
  }

  setReady(id: string, ready: boolean): void {
    const m = this.members.get(id);
    if (!m || this.inMatch) return;
    m.ready = ready;
    this.broadcastState();
  }

  /** Host-only lobby settings. All values are validated/clamped by the shared sanitizer. */
  update(by: string, patch: { config?: unknown; botFill?: unknown }): void {
    if (by !== this.hostId || this.inMatch) return;
    if (patch.config !== undefined) {
      this.config = sanitizeConfig({ ...this.config, ...(patch.config as object) }, this.config);
      if (this.config.mode === 'TEAMS') this.rebalanceTeams();
    }
    if (typeof patch.botFill === 'number' && Number.isFinite(patch.botFill)) this.botFill = Math.round(patch.botFill);
    this.clampBots();
    this.broadcastState();
  }

  // --- Match -------------------------------------------------------------------

  start(by: string): string | null {
    if (by !== this.hostId) return 'ONLY THE HOST CAN START';
    if (this.inMatch) return 'MATCH ALREADY RUNNING';
    const humans = [...this.members.values()].filter((m) => m.socketId !== null);
    let bots = Math.min(this.botFill, this.config.maxPlayers - humans.length);
    if (this.config.mode === 'TEAMS' && (humans.length + bots) % 2 === 1) {
      bots = bots + 1 <= this.config.maxPlayers - humans.length ? bots + 1 : bots - 1;
    }
    if (humans.length + bots < MIN_PLAYERS) return 'NEED AT LEAST 2 SUBJECTS';

    const seeds: PlayerSeed[] = humans.map((m) => ({ id: m.id, name: m.name, isBot: false, isHost: m.id === this.hostId, team: m.team }));
    const teamCount = { 1: humans.filter((m) => m.team === 1).length, 2: humans.filter((m) => m.team === 2).length };
    for (let i = 0; i < bots; i++) {
      let team: TeamId = 0;
      if (this.config.mode === 'TEAMS') {
        team = teamCount[1] <= teamCount[2] ? 1 : 2;
        teamCount[team] += 1;
      }
      seeds.push({ id: `bot-${this.code}-${i}`, name: BOT_NAMES[i % BOT_NAMES.length] ?? `Bot${i}`, isBot: true, botDifficulty: this.config.botDifficulty, team });
    }

    const config = { ...this.config, maxPlayers: seeds.length };
    this.runner = new MatchRunner(
      this.io,
      this.channel,
      config,
      seeds,
      (pid) => this.members.get(pid)?.socketId ?? null,
      () => [...this.members.keys()],
      () => this.finishMatch(),
    );
    for (const m of this.members.values()) m.ready = false;
    this.runner.start();
    this.broadcastState();
    return null;
  }

  input(id: string, input: PlayerInput): void {
    this.runner?.queueInput(id, input);
  }

  // --- State -------------------------------------------------------------------

  state(): RoomState {
    const members: RoomMember[] = [...this.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({
        id: m.id,
        name: m.name,
        isBot: false,
        isHost: m.id === this.hostId,
        ready: m.ready,
        connected: m.socketId !== null,
        team: this.config.mode === 'TEAMS' ? m.team : 0,
      }));
    return {
      code: this.code,
      visibility: this.visibility,
      hostId: this.hostId,
      members,
      config: this.config,
      botFill: this.botFill,
      inMatch: this.inMatch,
    };
  }

  broadcastState(): void {
    this.io.to(this.channel).emit('roomState', this.state());
  }

  close(): void {
    this.runner?.stop();
    this.runner = null;
    for (const m of this.members.values()) if (m.dropTimer) clearTimeout(m.dropTimer);
    this.io.to(this.channel).emit('roomState', null);
    this.io.in(this.channel).socketsLeave(this.channel);
    this.members.clear();
    this.onEmpty(this);
  }

  // --- Internals -----------------------------------------------------------------

  private finishMatch(): void {
    this.runner = null;
    this.broadcastState();
  }

  private transferHost(): void {
    const next = [...this.members.values()]
      .filter((m) => m.socketId !== null && m.id !== this.hostId)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next) return;
    this.hostId = next.id;
    this.runner?.sim.setHost(next.id);
    this.notice(`${next.name.toUpperCase()} IS NOW THE HOST`);
  }

  private anyConnected(): boolean {
    for (const m of this.members.values()) if (m.socketId) return true;
    return false;
  }

  private nextTeam(): TeamId {
    let a = 0;
    let b = 0;
    for (const m of this.members.values()) {
      if (m.team === 1) a++;
      else if (m.team === 2) b++;
    }
    return a <= b ? 1 : 2;
  }

  private rebalanceTeams(): void {
    let i = 0;
    for (const m of [...this.members.values()].sort((x, y) => x.joinedAt - y.joinedAt)) {
      m.team = ((i++ % 2) + 1) as TeamId;
    }
  }

  private clampBots(): void {
    this.botFill = Math.max(0, Math.min(this.botFill, this.config.maxPlayers - this.members.size));
  }

  private notice(message: string): void {
    this.io.to(this.channel).emit('notice', message);
  }
}
