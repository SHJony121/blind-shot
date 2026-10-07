import { useState } from 'react';
import {
  DEFAULT_MATCH_CONFIG,
  MAX_PLAYERS,
  ROOM_CODE_LENGTH,
  SUBJECT_COLORS,
  TEAM_COLORS,
  normalizeRoomCode,
  type MatchConfig,
} from '@blindshot/shared';
import { go } from '../../game/GameApp';
import { net } from '../../networking/NetClient';
import { settingsStore } from '../../state/settings';
import { useStore } from '../../state/store';
import { Button, Field, MAP_OPTIONS, Panel, Seg, Slider } from '../components';

/** CREATE ROOM / JOIN ROOM. */
export function OnlineMenu() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensureConnected = async () => {
    const ok = await net.connect(settingsStore.get().name);
    if (!ok) setError(net.store.get().error ?? 'CONNECTION FAILED');
    return ok;
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    if (await ensureConnected()) {
      const res = await net.createRoom({ ...DEFAULT_MATCH_CONFIG });
      if (res.ok) go('lobby');
      else setError(res.error);
    }
    setBusy(false);
  };

  const join = async () => {
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      setError('ROOM CODES ARE 5 CHARACTERS');
      return;
    }
    setBusy(true);
    setError(null);
    if (await ensureConnected()) {
      const res = await net.joinRoom(normalized);
      if (res.ok) go('lobby');
      else setError(res.error);
    }
    setBusy(false);
  };

  return (
    <div className="screen-center">
      <Panel title="PRIVATE ROOM" width={640}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 28 }}>
          <div>
            <div className="label" style={{ marginBottom: 10 }}>HOST A TEST</div>
            <Button variant="primary" disabled={busy} onClick={create}>
              CREATE ROOM
            </Button>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 10 }}>JOIN WITH CODE</div>
            <div className="row">
              <input
                className="code-input"
                value={code}
                maxLength={ROOM_CODE_LENGTH}
                placeholder="K7D4Q"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void join();
                }}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              <Button disabled={busy} onClick={join}>
                JOIN ROOM
              </Button>
            </div>
          </div>
        </div>
        {error ? <div className="error-text">{error}</div> : null}
        <div className="actions">
          <Button variant="ghost" onClick={() => go('menu')}>
            BACK
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/** Room lobby: members, host configuration, ready-up, start. */
export function Lobby() {
  const state = useStore(net.store);
  const room = state.room;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!room) {
    return (
      <div className="screen-center">
        <Panel title="ROOM CLOSED">
          <div className="actions">
            <Button variant="primary" onClick={() => go('menu')}>
              MAIN MENU
            </Button>
          </div>
        </Panel>
      </div>
    );
  }
  const me = room.members.find((m) => m.id === state.playerId);
  const isHost = room.hostId === state.playerId;
  const cfg = room.config;
  const set = (patch: Partial<MatchConfig>) => net.updateRoom({ config: patch });
  const humans = room.members.filter((m) => !m.isBot).length;
  const total = humans + room.botFill;
  const maxBots = Math.max(0, cfg.maxPlayers - humans);

  const start = async () => {
    setError(null);
    const res = await net.startMatch();
    if (!res.ok) setError(res.error);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; the code is on screen anyway.
    }
  };

  return (
    <div className="screen-center">
      <Panel width={980}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div className="label">{room.visibility === 'PUBLIC' ? 'PUBLIC LOBBY' : 'ROOM CODE — SEND THIS TO FRIENDS'}</div>
            <div className="room-code" onClick={copy} style={{ cursor: 'pointer' }} title="Copy code">
              {room.code}
            </div>
            {copied ? <div className="label" style={{ color: 'var(--good)' }}>COPIED</div> : null}
          </div>
          <div className="label">
            {total}/{cfg.maxPlayers} SUBJECTS · {cfg.mode === 'TEAMS' ? 'TEAMS' : 'FREE FOR ALL'}
          </div>
        </div>

        <div className="row" style={{ alignItems: 'flex-start', gap: 28, marginTop: 10 }}>
          <div style={{ flex: '1 1 300px' }}>
            <div className="member-list">
              {room.members.map((m, i) => (
                <div
                  key={m.id}
                  className="member"
                  style={{
                    borderLeftColor: cfg.mode === 'TEAMS' && m.team ? TEAM_COLORS[m.team] : SUBJECT_COLORS[i % SUBJECT_COLORS.length],
                  }}
                >
                  <span>{m.name.toUpperCase()}</span>
                  <span className="tags">
                    {m.id === state.playerId ? <span className="pill" style={{ color: 'var(--hazard)' }}>YOU</span> : null}
                    {m.isHost ? <span className="pill">HOST</span> : null}
                    {!m.connected ? <span className="pill" style={{ color: 'var(--danger)' }}>RECONNECTING</span> : null}
                    {m.ready || m.isHost ? <span className="pill" style={{ color: 'var(--good)' }}>READY</span> : <span className="pill">NOT READY</span>}
                  </span>
                </div>
              ))}
              {Array.from({ length: room.botFill }, (_, i) => (
                <div key={`bot${i}`} className="member" style={{ opacity: 0.7 }}>
                  <span>BOT {i + 1}</span>
                  <span className="tags">
                    <span className="pill">{cfg.botDifficulty}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: '1 1 460px' }}>
            {isHost ? (
              <>
                <Field label="MODE">
                  <Seg
                    value={cfg.mode}
                    options={[
                      { value: 'FFA', label: 'FREE FOR ALL' },
                      { value: 'TEAMS', label: 'TEAMS' },
                    ]}
                    onChange={(mode) => set({ mode })}
                  />
                </Field>
                <Field label="MAX PLAYERS">
                  <Slider value={cfg.maxPlayers} min={2} max={MAX_PLAYERS} step={cfg.mode === 'TEAMS' ? 2 : 1} onChange={(maxPlayers) => set({ maxPlayers })} />
                </Field>
                <Field label="FILL WITH BOTS">
                  <Slider value={Math.min(room.botFill, maxBots)} min={0} max={maxBots} step={1} onChange={(botFill) => net.updateRoom({ botFill })} />
                </Field>
                <Field label="BOT DIFFICULTY">
                  <Seg
                    value={cfg.botDifficulty}
                    options={[
                      { value: 'EASY', label: 'EASY' },
                      { value: 'NORMAL', label: 'NORMAL' },
                      { value: 'HARD', label: 'HARD' },
                    ]}
                    onChange={(botDifficulty) => set({ botDifficulty })}
                  />
                </Field>
                <Field label="ROUNDS TO WIN">
                  <Seg value={cfg.roundsToWin} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} onChange={(roundsToWin) => set({ roundsToWin })} />
                </Field>
                <Field label="VISIBLE / HIDDEN">
                  <div className="row">
                    <Slider value={cfg.visibleSeconds} min={3} max={8} step={0.5} format={(v) => `${v}S`} onChange={(visibleSeconds) => set({ visibleSeconds })} />
                    <Slider value={cfg.blindSeconds} min={3} max={8} step={1} format={(v) => `${v}S`} onChange={(blindSeconds) => set({ blindSeconds })} />
                  </div>
                </Field>
                <Field label="SHOTS">
                  <Seg
            value={cfg.fireOrder}
            options={[
              { value: 'SEQUENTIAL', label: 'ONE BY ONE' },
              { value: 'SIMULTANEOUS', label: 'ALL AT ONCE' },
            ]}
            onChange={(fireOrder) => set({ fireOrder })}
          />
                </Field>
                <Field label="FRIENDLY FIRE">
                  <Seg
                    value={cfg.friendlyFire}
                    options={[
                      { value: false, label: 'OFF' },
                      { value: true, label: 'ON' },
                    ]}
                    onChange={(friendlyFire) => set({ friendlyFire })}
                  />
                </Field>
                <Field label="MAP">
                  <Seg
            value={cfg.mapId}
            options={MAP_OPTIONS}
            onChange={(mapId) => set({ mapId })}
          />
                </Field>
              </>
            ) : (
              <div className="label" style={{ lineHeight: 1.8 }}>
                MODE: {cfg.mode === 'TEAMS' ? 'TEAMS' : 'FREE FOR ALL'}
                <br />
                ROUNDS TO WIN: {cfg.roundsToWin}
                <br />
                VISIBLE {cfg.visibleSeconds}S · BLIND {cfg.blindSeconds}S
                <br />
                SHOTS: {cfg.fireOrder === 'SEQUENTIAL' ? 'ONE BY ONE' : 'ALL AT ONCE'} · FRIENDLY FIRE: {cfg.friendlyFire ? 'ON' : 'OFF'}
                <br />
                MAP: {MAP_OPTIONS.find((m) => m.value === cfg.mapId)?.label}
                <br />
                <br />
                WAITING FOR THE HOST TO START…
              </div>
            )}
          </div>
        </div>

        {error ? <div className="error-text">{error}</div> : null}
        {state.notice ? <div className="label" style={{ color: 'var(--info)', marginTop: 8 }}>{state.notice}</div> : null}
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => {
              net.leaveRoom();
              go('menu');
            }}
          >
            LEAVE
          </Button>
          {isHost ? (
            <Button variant="primary" disabled={total < 2} onClick={start}>
              {total < 2 ? 'NEED 2 SUBJECTS' : 'START TEST'}
            </Button>
          ) : (
            <Button variant={me?.ready ? 'default' : 'primary'} onClick={() => net.setReady(!me?.ready)}>
              {me?.ready ? 'NOT READY' : 'READY'}
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
