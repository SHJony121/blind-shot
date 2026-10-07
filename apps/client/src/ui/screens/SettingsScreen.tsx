import { settingsStore } from '../../state/settings';
import { useStore } from '../../state/store';
import { Button, Field, Panel, Seg, Slider } from '../components';

const pct = (v: number) => `${Math.round(v * 100)}`;

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useStore(settingsStore);
  const set = settingsStore.set.bind(settingsStore);
  return (
    <Panel title="SETTINGS" width={1060}>
      <div className="settings-grid">
      <Field label="MUSIC">
        <Seg
          value={s.musicOn}
          options={[
            { value: true, label: 'ON' },
            { value: false, label: 'OFF' },
          ]}
          onChange={(musicOn) => set({ musicOn })}
        />
      </Field>
      <Field label="SOUND EFFECTS">
        <Seg
          value={s.soundOn}
          options={[
            { value: true, label: 'ON' },
            { value: false, label: 'OFF' },
          ]}
          onChange={(soundOn) => set({ soundOn })}
        />
      </Field>
      <Field label="MASTER VOLUME">
        <Slider value={s.masterVolume} min={0} max={1} step={0.05} format={pct} onChange={(masterVolume) => set({ masterVolume })} />
      </Field>
      <Field label="EFFECTS VOLUME">
        <Slider value={s.sfxVolume} min={0} max={1} step={0.05} format={pct} onChange={(sfxVolume) => set({ sfxVolume })} />
      </Field>
      <Field label="MUSIC VOLUME">
        <Slider value={s.musicVolume} min={0} max={1} step={0.05} format={pct} onChange={(musicVolume) => set({ musicVolume })} />
      </Field>
      <Field label="AIM MODE">
        <Seg
          value={s.aimMode}
          options={[
            { value: 'CURSOR', label: 'CURSOR' },
            { value: 'MOUSE_TURN', label: 'MOUSE TURN (LOCKED)' },
          ]}
          onChange={(aimMode) => set({ aimMode })}
        />
      </Field>
      <Field label="MOUSE SENSITIVITY">
        <Slider value={s.mouseSensitivity} min={0.2} max={3} step={0.1} format={(v) => v.toFixed(1)} onChange={(mouseSensitivity) => set({ mouseSensitivity })} />
      </Field>
      <Field label="SCREEN SHAKE">
        <Seg
          value={s.screenShake}
          options={[
            { value: true, label: 'ON' },
            { value: false, label: 'OFF' },
          ]}
          onChange={(screenShake) => set({ screenShake })}
        />
      </Field>
      <Field label="FLASHES">
        <Seg
          value={s.reducedFlash}
          options={[
            { value: false, label: 'FULL' },
            { value: true, label: 'REDUCED' },
          ]}
          onChange={(reducedFlash) => set({ reducedFlash })}
        />
      </Field>
      <Field label="LASER COLOURS">
        <Seg
          value={s.laserPalette}
          options={[
            { value: 'SUBJECT', label: 'SUBJECT COLOURS' },
            { value: 'HIGH_CONTRAST', label: 'COLOURBLIND / HIGH CONTRAST' },
          ]}
          onChange={(laserPalette) => set({ laserPalette })}
        />
      </Field>
      <Field label="SHADOWS">
        <Seg
          value={s.shadows}
          options={[
            { value: true, label: 'ON' },
            { value: false, label: 'OFF (FASTER)' },
          ]}
          onChange={(shadows) => set({ shadows })}
        />
      </Field>
      </div>
      <div className="actions">
        <Button variant="primary" onClick={onClose}>
          DONE
        </Button>
      </div>
    </Panel>
  );
}
