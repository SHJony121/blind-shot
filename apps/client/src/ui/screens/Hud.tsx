import { SUBJECT_COLORS, TEAM_COLORS, TEAM_NAMES, subjectLabel, type PlayerInfo } from '@blindshot/shared';
import { hudStore } from '../../state/hud';
import { settingsStore } from '../../state/settings';
import { useStore } from '../../state/store';
import { Button, Panel } from '../components';
import { SettingsPanel } from './SettingsScreen';
import { useState } from 'react';

const pad2 = (n: number) => String(n).padStart(2, '0');

function colorOf(p: PlayerInfo, teams: boolean): string {
  return teams && p.team ? TEAM_COLORS[p.team] : SUBJECT_COLORS[p.colorIndex] ?? '#e3b23c';
}

function nameOf(p: PlayerInfo | undefined, localId: string): string {
  if (!p) return 'NOBODY';
  return p.id === localId ? 'YOU' : `${subjectLabel(p.subject)}`;
}

export interface HudActions {
  onResume: () => void;
  onQuit: () => void;
  onPlayAgain: () => void;
}

export function Hud({ actions }: { actions: HudActions }) {
  const h = useStore(hudStore);
  const settings = useStore(settingsStore);
  if (!h.active) return null;
  const teams = h.config?.mode === 'TEAMS';
  const roster = [...h.roster].sort((a, b) => a.subject - b.subject);
  const need = h.config?.roundsToWin ?? 3;
  const hiddenPhase = h.phase === 'HIDE' || h.phase === 'COUNTDOWN';
  const barPhases = h.phase === 'VISIBLE' || h.phase === 'COUNTDOWN';

  return (
    <div className="overlay">
      {hiddenPhase ? <div className="vignette-blind" /> : null}
      {h.flashId > 0 ? <div key={h.flashId} className={`flash ${settings.reducedFlash ? 'reduced' : ''}`} /> : null}

      <div className="roster">
        {roster.map((p) => (
          <div key={p.id} className={`roster-item ${!p.alive || !p.inRound ? 'dead' : ''} ${p.id === h.localId ? 'me' : ''}`}>
            <span className="swatch" style={{ background: colorOf(p, teams) }} />
            <span className="num">{pad2(p.subject)}</span>
            <span className="name">{p.id === h.localId ? `${p.name.toUpperCase()} (YOU)` : p.name.toUpperCase()}</span>
            {!teams ? (
              <span className="wins">
                {Array.from({ length: need }, (_, i) => (
                  <span key={i} className={`pip ${i < p.stats.roundWins ? 'on' : ''}`} />
                ))}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="hud-top">
        <div className="round-chip">
          ROUND <b>{pad2(h.round)}</b> · SHOT <b>{h.shot}</b>
        </div>
        {teams ? (
          <div className="team-score">
            <span style={{ color: TEAM_COLORS[1] }}>{h.teamWins[1] ?? 0}</span>
            <span className="label">FIRST TO {need}</span>
            <span style={{ color: TEAM_COLORS[2] }}>{h.teamWins[2] ?? 0}</span>
          </div>
        ) : null}
        {barPhases && h.phaseDuration > 0 ? (
          <div className={`phase-bar ${h.phase !== 'VISIBLE' ? 'danger' : ''}`}>
            <div style={{ width: `${Math.max(0, Math.min(100, (h.timeLeft / h.phaseDuration) * 100))}%` }} />
          </div>
        ) : null}
      </div>

      {h.roomCode ? <div className="room-chip">ROOM {h.roomCode}</div> : null}

      {h.banner && !h.roundResult && !h.matchResult ? (
        <div className="banner-wrap">
          <div key={h.banner.id} className={`banner ${h.banner.size} ${h.banner.tone}`}>
            {h.banner.tone === 'danger' && h.banner.subtitle === 'SHOOTOUT IN' ? <div className="sub">SHOOTOUT IN</div> : null}
            <div className="title">{h.banner.title}</div>
            {h.banner.subtitle && h.banner.subtitle !== 'SHOOTOUT IN' ? <div className="sub">{h.banner.subtitle}</div> : null}
          </div>
        </div>
      ) : null}

      {h.popup && h.phase === 'COUNTDOWN' && !h.paused ? (
        <div className="popup-wrap">
          <div className="popup">
            <div className="popup-title">{h.popup.title}</div>
            <div key={h.popup.value} className="popup-value">
              {h.popup.value}
            </div>
            <div className="popup-sub">THEN EVERYONE FREEZES</div>
          </div>
        </div>
      ) : null}

      {h.roundResult && !h.matchResult ? <RoundResult /> : null}

      {h.spectating && !h.roundResult && !h.matchResult ? <div className="spectating">ELIMINATED · SPECTATING</div> : null}

      {h.hintsVisible && (h.phase === 'VISIBLE' || h.phase === 'SPAWN') && h.round === 1 ? (
        <div className="hints">
          <div className="hint">
            <kbd>MOUSE</kbd> AIM
          </div>
          <div className="hint">
            <kbd>WASD</kbd> MOVE
          </div>
          <div className="hint">
            <kbd>SHIFT</kbd> SPRINT
          </div>
          <div className="hint">SHOTS FIRE AUTOMATICALLY AFTER THE FREEZE</div>
        </div>
      ) : null}

      {h.showScoreboard && !h.matchResult ? (
        <div className="screen-center" style={{ background: 'rgba(8,10,12,0.4)' }}>
          <Panel title="SCOREBOARD" width={760}>
            <StatsTable roster={roster} localId={h.localId} winners={[]} teams={teams} />
          </Panel>
        </div>
      ) : null}

      {h.paused && !h.matchResult ? <PauseMenu actions={actions} online={h.online} /> : null}
      {h.matchResult ? <MatchResults actions={actions} /> : null}
    </div>
  );
}

function RoundResult() {
  const h = useStore(hudStore);
  const r = h.roundResult;
  if (!r) return null;
  const roster = r.roster;
  const me = roster.find((p) => p.id === h.localId);
  let title: string;
  if (r.draw) title = 'ROUND DRAW';
  else if (r.winnerTeam) title = `${TEAM_NAMES[r.winnerTeam as 1 | 2]} WINS`;
  else title = r.winnerIds[0] === h.localId ? 'YOU WIN THE ROUND' : `${nameOf(roster.find((p) => p.id === r.winnerIds[0]), h.localId)} WINS`;
  const winner = roster.find((p) => p.id === r.winnerIds[0]);
  return (
    <div className="screen-center" style={{ background: 'transparent' }}>
      <div className="panel results-card">
        <div className="label">ROUND {pad2(r.round)} · TEST COMPLETE</div>
        <div className="winner">{title}</div>
        {winner && !r.winnerTeam && winner.id !== h.localId ? <div className="label" style={{ fontSize: 20 }}>{winner.name.toUpperCase()}</div> : null}
        {me ? (
          <div className="lines">
            <span>
              HITS: <b>{me.stats.hits}</b>
            </span>
            <span>
              SURVIVED: <b>{me.alive ? 'YES' : 'NO'}</b>
            </span>
            <span>
              SCORE: <b>{me.stats.score}</b>
            </span>
          </div>
        ) : null}
        <div className="next-in">{r.matchOver ? 'FINAL RESULTS INCOMING…' : `NEXT ROUND IN ${Math.max(1, Math.ceil(h.timeLeft))}…`}</div>
      </div>
    </div>
  );
}

function StatsTable({ roster, localId, winners, teams }: { roster: PlayerInfo[]; localId: string; winners: string[]; teams: boolean }) {
  const sorted = [...roster].sort((a, b) => b.stats.roundWins - a.stats.roundWins || b.stats.score - a.stats.score);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>SUBJECT</th>
          {teams ? <th>TEAM</th> : null}
          <th>ROUND WINS</th>
          <th>HITS</th>
          <th>SHOTS</th>
          <th>ACCURACY</th>
          <th>SURVIVAL</th>
          <th>SCORE</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.id} className={`${p.id === localId ? 'me' : ''} ${winners.includes(p.id) ? 'winner' : ''}`}>
            <td>
              <span style={{ color: SUBJECT_COLORS[p.colorIndex], marginRight: 8 }}>■</span>
              {pad2(p.subject)} {p.name.toUpperCase()}
              {p.isBot ? <span className="label" style={{ marginLeft: 8 }}>BOT</span> : null}
            </td>
            {teams ? <td style={{ color: p.team ? TEAM_COLORS[p.team] : undefined }}>{p.team === 1 ? 'BLUE' : 'ORANGE'}</td> : null}
            <td>{p.stats.roundWins}</td>
            <td>{p.stats.hits}</td>
            <td>{p.stats.shots}</td>
            <td>{p.stats.shots ? Math.round((p.stats.hits / p.stats.shots) * 100) : 0}%</td>
            <td>{p.stats.shots ? Math.round((p.stats.shotsSurvived / p.stats.shots) * 100) : 0}%</td>
            <td>{p.stats.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PauseMenu({ actions, online }: { actions: HudActions; online: boolean }) {
  const [settings, setSettings] = useState(false);
  if (settings) {
    return (
      <div className="screen-center">
        <SettingsPanel onClose={() => setSettings(false)} />
      </div>
    );
  }
  return (
    <div className="screen-center">
      <Panel title={online ? 'MENU' : 'PAUSED'} width={420}>
        {online ? <div className="label" style={{ marginBottom: 14 }}>THE TEST CONTINUES WITHOUT YOU…</div> : null}
        <div className="menu-buttons" style={{ alignItems: 'stretch' }}>
          <Button variant="primary" onClick={actions.onResume}>
            RESUME
          </Button>
          <Button onClick={() => setSettings(true)}>SETTINGS</Button>
          <Button variant="danger" onClick={actions.onQuit}>
            QUIT TO MENU
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function MatchResults({ actions }: { actions: HudActions }) {
  const h = useStore(hudStore);
  const m = h.matchResult;
  if (!m) return null;
  const teams = h.config?.mode === 'TEAMS';
  const winner = m.roster.find((p) => p.id === m.winnerIds[0]);
  const iWon = m.winnerIds.includes(h.localId);
  let title = 'NO WINNER';
  if (!m.draw) {
    if (m.winnerTeam) title = `${TEAM_NAMES[m.winnerTeam as 1 | 2]} WINS`;
    else if (winner) title = iWon ? 'YOU WIN' : `${subjectLabel(winner.subject)} WINS`;
  }
  return (
    <div className="screen-center">
      <Panel width={900}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div className="label">TEST COMPLETE · WINNER</div>
          <div className="winner display" style={{ fontSize: 'clamp(56px, 8vw, 110px)', color: 'var(--hazard)', textShadow: '5px 5px 0 #000' }}>
            {title}
          </div>
          {winner && !m.winnerTeam ? <div className="display" style={{ fontSize: 30 }}>{winner.name.toUpperCase()}</div> : null}
          {teams ? (
            <div className="team-score" style={{ justifyContent: 'center', marginTop: 8 }}>
              <span style={{ color: TEAM_COLORS[1] }}>{m.teamWins[1] ?? 0}</span>
              <span className="label">ROUNDS</span>
              <span style={{ color: TEAM_COLORS[2] }}>{m.teamWins[2] ?? 0}</span>
            </div>
          ) : null}
        </div>
        <StatsTable roster={m.roster} localId={h.localId} winners={m.winnerIds} teams={teams} />
        <div className="actions">
          <Button variant="ghost" onClick={actions.onQuit}>
            MAIN MENU
          </Button>
          <Button variant="primary" onClick={actions.onPlayAgain}>
            {h.online ? 'BACK TO LOBBY' : 'PLAY AGAIN'}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
