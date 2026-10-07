import { subjectLabel, TEAM_NAMES, type PhaseChangedEvent, type PlayerInfo, type ShootoutEvent } from '@blindshot/shared';
import { audio } from '../../audio/AudioEngine';
import type { TestChamber } from '../../maps/TestChamber';
import { clearBanner, hudStore, showBanner, type RevealSummary } from '../../../state/hud';

type Schedule = (delay: number, fn: () => void) => void;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Presentation of the Blind Shot round state machine: banners, chamber lighting,
 * wall displays and phase sounds. Purely reactive — it never changes game state.
 */
export class BlindShotPresenter {
  private lastCountdown = 0;
  private warned = false;
  private heartbeatIn = 0;
  private lastShootout: ShootoutEvent | null = null;

  constructor(
    private readonly chamber: TestChamber,
    private readonly schedule: Schedule,
    private readonly localId: string,
  ) {}

  onPhase(e: PhaseChangedEvent, roster: readonly PlayerInfo[]): void {
    const c = this.chamber;
    switch (e.phase) {
      case 'ROUND_INTRO':
        c.setMood('normal');
        c.setDisplay(`ROUND ${pad2(e.round)}`, 'TEST BEGINNING');
        hudStore.set({ roundResult: null, reveal: null });
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
        c.setMood('normal');
        c.setDisplay('MEMORIZE', e.shot > 1 ? `SHOT ${e.shot}` : 'TARGETS VISIBLE');
        showBanner('AIM.', { subtitle: e.shot > 1 ? `SHOT ${e.shot} · MEMORIZE THEIR POSITIONS` : 'MEMORIZE THEIR POSITIONS', size: 'lg' });
        hudStore.set({ reveal: null });
        audio.setLaserHum(true);
        break;
      case 'HIDE':
        audio.setLaserHum(false);
        audio.lightsOff();
        c.flicker(0.45);
        c.setMood('blind');
        c.setDisplay('BLIND', 'VISUAL FEED DISABLED', '#ff4b3a');
        showBanner('VISUAL FEED DISABLED', { tone: 'danger', size: 'lg' });
        break;
      case 'BLIND':
        showBanner('TARGETS HIDDEN', { subtitle: 'REMEMBER WHERE THEY WERE', tone: 'danger', size: 'lg' });
        this.heartbeatIn = 0;
        break;
      case 'COUNTDOWN':
        this.lastCountdown = 0;
        c.setMood('alert');
        break;
      case 'FIRE':
        clearBanner();
        c.setMood('normal');
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
        audio.setLaserHum(false);
        c.setMood('menu');
        c.setDisplay('TEST COMPLETE', 'THANK YOU, SUBJECTS');
        clearBanner();
        break;
      default:
        break;
    }
  }

  onShootout(e: ShootoutEvent): void {
    this.lastShootout = e;
  }

  /** Per-frame: countdown ticks, pre-hide warning, blind heartbeat. */
  tick(dt: number, phase: string, timeLeft: number): void {
    if (phase === 'VISIBLE' && !this.warned && timeLeft < 0.65) {
      this.warned = true;
      audio.warning();
      this.chamber.flicker(0.12);
    }
    if (phase === 'BLIND' || phase === 'COUNTDOWN') {
      this.heartbeatIn -= dt;
      if (this.heartbeatIn <= 0) {
        audio.heartbeat();
        this.heartbeatIn = phase === 'COUNTDOWN' ? 0.55 : 0.8;
      }
    }
    if (phase === 'COUNTDOWN') {
      const n = Math.max(1, Math.ceil(timeLeft - 1e-3));
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        audio.countdownBeep(n);
        this.chamber.pulse();
        this.chamber.setDisplay(`SHOOTOUT IN ${n}`, '', '#ff4b3a');
        showBanner(String(n), { subtitle: 'SHOOTOUT IN', tone: 'danger', size: 'xl' });
        hudStore.set({ countdown: n });
      }
    } else if (hudStore.get().countdown !== null) {
      hudStore.set({ countdown: null });
    }
  }

  /** Turn the last volley into the line that makes people laugh. */
  private revealSummary(roster: readonly PlayerInfo[]): RevealSummary {
    const e = this.lastShootout;
    const byId = new Map(roster.map((p) => [p.id, p]));
    const label = (id: string) => {
      const p = byId.get(id);
      if (!p) return 'A SUBJECT';
      return id === this.localId ? 'YOU' : subjectLabel(p.subject);
    };
    const alive = roster.filter((p) => p.alive && p.inRound);
    const survivors = `${alive.length} SURVIVOR${alive.length === 1 ? '' : 'S'}`;
    if (!e) return { headline: survivors };

    const hits = e.shots.filter((s) => s.hitPlayerId);
    const mutual = hits.find((a) => hits.some((b) => b.shooterId === a.hitPlayerId && b.hitPlayerId === a.shooterId));
    const hitCount = new Map<string, number>();
    for (const s of hits) hitCount.set(s.hitPlayerId!, (hitCount.get(s.hitPlayerId!) ?? 0) + 1);
    const overkill = [...hitCount.entries()].find(([, n]) => n >= 3);

    const killer = hits.find((s) => s.hitPlayerId === this.localId);
    const teams = new Set(alive.map((p) => p.team));
    const teamLine =
      alive.length > 0 && teams.size === 1 && alive[0]!.team !== 0 ? `${TEAM_NAMES[alive[0]!.team as 1 | 2]} STANDING` : survivors;

    if (killer) {
      return { headline: 'YOU WERE ELIMINATED', detail: `BY ${label(killer.shooterId)}` };
    }
    if (hits.length === 0) return { headline: 'EVERYBODY MISSED', detail: teamLine };
    if (overkill) return { headline: 'OVERKILL', detail: `${overkill[1]} SHOTS ON ${label(overkill[0])}` };
    if (mutual) return { headline: 'MUTUAL ELIMINATION', detail: `${label(mutual.shooterId)} × ${label(mutual.hitPlayerId!)}` };
    if (hits.length >= 2 && alive.length === 0) return { headline: 'NOBODY SURVIVED', detail: 'DRAW' };
    const mine = hits.filter((s) => s.shooterId === this.localId);
    if (mine.length > 0) return { headline: 'DIRECT HIT', detail: teamLine };
    return { headline: teamLine };
  }
}
