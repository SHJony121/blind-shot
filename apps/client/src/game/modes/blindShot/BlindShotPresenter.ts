import { subjectLabel, TEAM_NAMES, type PhaseChangedEvent, type PlayerInfo, type ShotFiredEvent } from '@blindshot/shared';
import { audio } from '../../audio/AudioEngine';
import type { ArenaView } from '../../maps/ArenaView';
import { clearBanner, hudStore, showBanner, type RevealSummary } from '../../../state/hud';

type Schedule = (delay: number, fn: () => void) => void;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Presentation of the Blind Shot round state machine: banners, popups, chamber lighting,
 * wall displays and phase sounds. Purely reactive — it never changes game state.
 */
export class BlindShotPresenter {
  private lastCountdown = 0;
  private warned = false;
  private heartbeatIn = 0;
  private volley: ShotFiredEvent[] = [];
  private roster: readonly PlayerInfo[] = [];

  constructor(
    private readonly chamber: () => ArenaView,
    private readonly schedule: Schedule,
    private readonly localId: string,
  ) {}

  onPhase(e: PhaseChangedEvent, roster: readonly PlayerInfo[]): void {
    const c = this.chamber();
    this.roster = roster;
    switch (e.phase) {
      case 'ROUND_INTRO':
        c.setMood('normal');
        c.setDisplay(`ROUND ${pad2(e.round)}`, 'TEST BEGINNING');
        hudStore.set({ roundResult: null, reveal: null, popup: null });
        showBanner(`ROUND ${pad2(e.round)}`, { size: 'xl' });
        audio.whoosh();
        this.schedule(0.6, () => showBanner('BLIND SHOT', { size: 'xl', tone: 'info' }));
        this.schedule(1.2, () => showBanner('MEMORIZE YOUR TARGET.', { size: 'lg' }));
        break;
      case 'SPAWN':
        c.setDisplay('SUBJECTS READY', `${e.aliveCount} SUBJECTS`);
        showBanner('SUBJECTS READY', { size: 'md' });
        break;
      case 'VISIBLE':
        this.warned = false;
        this.volley = [];
        c.setMood('normal');
        c.setDisplay('MEMORIZE', e.shot > 1 ? `SHOT ${e.shot}` : 'TARGETS VISIBLE');
        showBanner('AIM.', { subtitle: e.shot > 1 ? `SHOT ${e.shot} · MEMORIZE THEIR POSITIONS` : 'MEMORIZE THEIR POSITIONS', size: 'lg' });
        hudStore.set({ reveal: null, popup: null });
        break;
      case 'HIDE':
        audio.lightsOff();
        c.flicker(0.45);
        c.setMood('blind');
        c.setDisplay('BLIND', 'VISUAL FEED DISABLED', '#ff4b3a');
        showBanner('TARGETS HIDDEN', { subtitle: 'MOVE. AIM. REMEMBER WHERE THEY WERE.', tone: 'danger', size: 'lg' });
        this.heartbeatIn = 0.4;
        break;
      case 'COUNTDOWN':
        this.lastCountdown = 0;
        c.setMood('alert');
        break;
      case 'FREEZE':
        hudStore.set({ popup: null, countdown: null });
        c.setMood('normal');
        c.setDisplay('FREEZE', 'AIMS LOCKED', '#ffffff');
        showBanner('FREEZE!', { subtitle: 'AIMS LOCKED · NOBODY MOVES', size: 'xl', tone: 'info' });
        audio.freeze();
        break;
      case 'SHOOTING':
        clearBanner();
        c.setDisplay('FIRE', '', '#ffffff');
        break;
      case 'REVEAL': {
        const summary = this.revealSummary(roster);
        hudStore.set({ reveal: summary });
        showBanner(summary.headline, { subtitle: summary.detail, size: 'lg', tone: 'info' });
        c.setDisplay(summary.headline.length > 14 ? 'RESULTS' : summary.headline, summary.detail ?? '');
        break;
      }
      case 'ROUND_RESULTS':
        clearBanner();
        c.setDisplay('TEST COMPLETE', `ROUND ${pad2(e.round)}`);
        break;
      case 'MATCH_END':
        c.setMood('menu');
        c.setDisplay('TEST COMPLETE', 'THANK YOU, SUBJECTS');
        clearBanner();
        break;
      default:
        break;
    }
  }

  onShot(e: ShotFiredEvent): void {
    this.volley.push(e);
    if (e.simultaneous) return;
    const shooter = this.roster.find((p) => p.id === e.result.shooterId);
    const who = e.result.shooterId === this.localId ? 'YOU' : shooter ? subjectLabel(shooter.subject) : 'A SUBJECT';
    const hit = e.eliminated[0];
    const victim = hit ? this.roster.find((p) => p.id === hit) : undefined;
    const victimName = hit === this.localId ? 'YOU' : victim ? subjectLabel(victim.subject) : '';
    showBanner(hit ? 'HIT!' : 'MISS', {
      subtitle: hit ? `${who} → ${victimName}` : `${who} FIRED`,
      size: 'md',
      tone: hit ? 'danger' : 'neutral',
    });
  }

  /** Per-frame: countdown popup ticks, pre-hide warning, blind heartbeat. */
  tick(dt: number, phase: string, timeLeft: number): void {
    const c = this.chamber();
    if (phase === 'VISIBLE' && !this.warned && timeLeft < 0.65) {
      this.warned = true;
      audio.warning();
      c.flicker(0.12);
    }
    if (phase === 'HIDE' || phase === 'COUNTDOWN') {
      this.heartbeatIn -= dt;
      if (this.heartbeatIn <= 0) {
        audio.heartbeat();
        this.heartbeatIn = phase === 'COUNTDOWN' && timeLeft < 2.5 ? 0.5 : 0.8;
      }
    }
    if (phase === 'COUNTDOWN') {
      const n = Math.max(1, Math.ceil(timeLeft - 1e-3));
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        audio.countdownBeep(n);
        c.pulse();
        c.setDisplay(`REVEAL IN ${n}`, 'THEN EVERYONE FREEZES', '#ff4b3a');
        hudStore.set({ countdown: n, popup: { id: Date.now(), title: 'PLAYERS REVEALED IN', value: String(n) } });
      }
    }
  }

  /** Turn the last volley into the line that makes people laugh. */
  private revealSummary(roster: readonly PlayerInfo[]): RevealSummary {
    const byId = new Map(roster.map((p) => [p.id, p]));
    const label = (id: string) => {
      const p = byId.get(id);
      if (!p) return 'A SUBJECT';
      return id === this.localId ? 'YOU' : subjectLabel(p.subject);
    };
    const alive = roster.filter((p) => p.alive && p.inRound);
    const survivors = `${alive.length} SURVIVOR${alive.length === 1 ? '' : 'S'}`;
    const shots = this.volley.map((v) => v.result);
    if (shots.length === 0) return { headline: survivors };

    const hits = shots.filter((s) => s.hitPlayerId);
    const mutual = hits.find((a) => hits.some((b) => b.shooterId === a.hitPlayerId && b.hitPlayerId === a.shooterId));
    const killer = hits.find((s) => s.hitPlayerId === this.localId);
    const teams = new Set(alive.map((p) => p.team));
    const teamLine =
      alive.length > 0 && teams.size === 1 && alive[0]!.team !== 0 ? `${TEAM_NAMES[alive[0]!.team as 1 | 2]} STANDING` : survivors;
    const multi = new Map<string, number>();
    for (const s of hits) multi.set(s.shooterId, (multi.get(s.shooterId) ?? 0) + 1);

    if (killer) return { headline: 'YOU WERE ELIMINATED', detail: `BY ${label(killer.shooterId)}` };
    if (hits.length === 0) return { headline: 'EVERYBODY MISSED', detail: teamLine };
    if (mutual) return { headline: 'MUTUAL ELIMINATION', detail: `${label(mutual.shooterId)} × ${label(mutual.hitPlayerId!)}` };
    if (alive.length === 0) return { headline: 'NOBODY SURVIVED', detail: 'DRAW' };
    if (hits.some((s) => s.shooterId === this.localId)) return { headline: 'DIRECT HIT', detail: teamLine };
    return { headline: teamLine, detail: `${hits.length} DOWN` };
  }
}
