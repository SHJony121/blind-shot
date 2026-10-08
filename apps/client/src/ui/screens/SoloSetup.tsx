import { useState } from 'react';
import { DEFAULT_MATCH_CONFIG, type BotDifficulty, type MatchConfig } from '@blindshot/shared';
import { go } from '../../game/GameApp';
import { Button, Field, MAP_OPTIONS, Panel, Seg, Slider } from '../components';

export interface SoloChoice {
  bots: number;
  difficulty: BotDifficulty;
  config: MatchConfig;
}

const KEY = 'blindshot.solo.v4';

function loadChoice(): SoloChoice {
  const base: SoloChoice = { bots: 3, difficulty: 'NORMAL', config: { ...DEFAULT_MATCH_CONFIG } };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SoloChoice>;
      return { ...base, ...parsed, config: { ...base.config, ...(parsed.config ?? {}) } };
    }
  } catch {
    // ignore
  }
  return base;
}

export function SoloSetup({ onStart }: { onStart: (c: SoloChoice) => void }) {
  const [choice, setChoice] = useState<SoloChoice>(loadChoice);
  const cfg = choice.config;
  const set = (patch: Partial<MatchConfig>) => setChoice((c) => ({ ...c, config: { ...c.config, ...patch } }));
  const teams = cfg.mode === 'TEAMS';
  const botOptions = teams ? [1, 3, 5, 7] : [1, 2, 3, 4, 5, 6, 7];

  const start = () => {
    let bots = choice.bots;
    if (teams && bots % 2 === 0) bots = Math.min(7, bots + 1);
    const final = { ...choice, bots, config: { ...cfg, botDifficulty: choice.difficulty } };
    try {
      localStorage.setItem(KEY, JSON.stringify(final));
    } catch {
      // ignore
    }
    onStart(final);
  };

  return (
    <div className="screen-center">
      <Panel title="SOLO TEST" width={720}>
        <Field label="MODE">
          <Seg
            value={cfg.mode}
            options={[
              { value: 'FFA', label: 'FREE FOR ALL' },
              { value: 'TEAMS', label: 'TEAMS' },
            ]}
            onChange={(mode) => {
              set({ mode });
              if (mode === 'TEAMS' && choice.bots % 2 === 0) setChoice((c) => ({ ...c, bots: Math.min(7, c.bots + 1) }));
            }}
          />
        </Field>
        <Field label="OPPONENTS">
          <Seg
            value={choice.bots}
            options={botOptions.map((n) => ({ value: n, label: teams ? `${(n + 1) / 2}V${(n + 1) / 2}` : String(n) }))}
            onChange={(bots) => setChoice((c) => ({ ...c, bots }))}
          />
        </Field>
        <Field label="BOT DIFFICULTY">
          <Seg
            value={choice.difficulty}
            options={[
              { value: 'EASY', label: 'EASY' },
              { value: 'NORMAL', label: 'NORMAL' },
              { value: 'HARD', label: 'HARD' },
            ]}
            onChange={(difficulty) => setChoice((c) => ({ ...c, difficulty }))}
          />
        </Field>
        <Field label="ROUNDS TO WIN">
          <Seg
            value={cfg.roundsToWin}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: n === 3 ? '3 (BO5)' : String(n) }))}
            onChange={(roundsToWin) => set({ roundsToWin })}
          />
        </Field>
        <Field label="VISIBLE PHASE">
          <Slider value={cfg.visibleSeconds} min={3} max={15} step={1} format={(v) => `${v}S`} onChange={(visibleSeconds) => set({ visibleSeconds })} />
        </Field>
        <Field label="HIDDEN: MOVE TIME">
          <Slider value={cfg.repositionSeconds} min={2} max={15} step={1} format={(v) => `${v}S`} onChange={(repositionSeconds) => set({ repositionSeconds })} />
        </Field>
        <Field label="HIDDEN: LOCKED COUNTDOWN">
          <Slider value={cfg.blindSeconds} min={3} max={15} step={1} format={(v) => `${v}S`} onChange={(blindSeconds) => set({ blindSeconds })} />
        </Field>
        <Field label="MAP">
          <Seg
            value={cfg.mapId}
            options={MAP_OPTIONS}
            onChange={(mapId) => set({ mapId })}
          />
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
        {teams ? (
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
        ) : null}
        <div className="actions">
          <Button variant="ghost" onClick={() => go('menu')}>
            BACK
          </Button>
          <Button variant="primary" onClick={start}>
            START TEST
          </Button>
        </div>
      </Panel>
    </div>
  );
}
