import { useState } from 'react';
import { NAME_MAX_LENGTH, SKINS, sanitizeName } from '@blindshot/shared';
import { SKIN_LABELS } from '../../game/characters/SubjectModel';
import { audio } from '../../game/audio/AudioEngine';
import { go } from '../../game/GameApp';
import { net } from '../../networking/NetClient';
import { settingsStore } from '../../state/settings';
import { useStore } from '../../state/store';
import { Button } from '../components';

export function MainMenu({ onQuickPlay }: { onQuickPlay: () => Promise<string | null> }) {
  const settings = useStore(settingsStore);
  const [name, setName] = useState(settings.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commitName = () => {
    const clean = sanitizeName(name, settings.name);
    setName(clean);
    settingsStore.set({ name: clean });
    return clean;
  };

  const cycleSkin = (dir: number) => {
    audio.unlock();
    audio.uiClick();
    const i = SKINS.indexOf(settings.skin);
    const next = SKINS[(i + dir + SKINS.length) % SKINS.length] ?? 'DUMMY';
    settingsStore.set({ skin: next });
  };

  const quickPlay = async () => {
    commitName();
    setBusy(true);
    setError(null);
    const err = await onQuickPlay();
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="menu" onPointerDown={() => audio.unlock()}>
      <h1 className="logo">
        <span className="blind flick">BLIND</span>
        <span className="shot">SHOT</span>
      </h1>
      <div className="stripe" />
      <div className="subtitle">
        <span>REMEMBER.</span>
        <span>AIM.</span>
        <span>FIRE.</span>
      </div>

      <label className="id-tag">
        <span className="tag-label">SUBJECT</span>
        <input
          value={name}
          maxLength={NAME_MAX_LENGTH}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-label="Your name"
        />
      </label>

      <div className="skin-picker">
        <span className="tag-label">LOOK</span>
        <button type="button" aria-label="Previous character" onClick={() => cycleSkin(-1)}>
          ◀
        </button>
        <span className="skin-name">{SKIN_LABELS[settings.skin]}</span>
        <button type="button" aria-label="Next character" onClick={() => cycleSkin(1)}>
          ▶
        </button>
      </div>

      <div className="menu-buttons">
        <Button variant="primary" disabled={busy} onClick={quickPlay}>
          {busy ? 'SEARCHING…' : 'PLAY'}
        </Button>
        <Button
          onClick={() => {
            commitName();
            go('solo');
          }}
        >
          SOLO
        </Button>
        <Button
          onClick={() => {
            commitName();
            go('online');
          }}
        >
          PRIVATE ROOM
        </Button>
        <Button onClick={() => go('howto')}>HOW TO PLAY</Button>
        <Button onClick={() => go('settings')}>SETTINGS</Button>
        {error ? (
          <div className="error-text">
            {error} — TRY <u style={{ cursor: 'pointer' }} onClick={() => go('solo')}>SOLO</u>
          </div>
        ) : null}
        {net.store.get().status === 'connecting' ? <div className="label">CONNECTING…</div> : null}
      </div>
      <div className="menu-foot">ALL SUBJECTS ARE VOLUNTEERS · v1.0</div>
    </div>
  );
}
