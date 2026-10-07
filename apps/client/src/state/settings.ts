import { guestName, sanitizeName } from '@blindshot/shared';
import { Store } from './store';

export type AimMode = 'CURSOR' | 'MOUSE_TURN';
export type LaserPalette = 'SUBJECT' | 'HIGH_CONTRAST';

export interface Settings {
  name: string;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  /** Turn speed in MOUSE_TURN aim mode. */
  mouseSensitivity: number;
  /** How much the camera leans toward where you aim (0 = static). */
  cameraSway: number;
  screenShake: boolean;
  reducedFlash: boolean;
  laserPalette: LaserPalette;
  aimMode: AimMode;
  shadows: boolean;
  seenTutorial: boolean;
}

const KEY = 'blindshot.settings.v1';

const defaults = (): Settings => ({
  name: guestName(),
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  mouseSensitivity: 1,
  cameraSway: 0.5,
  screenShake: true,
  reducedFlash: false,
  laserPalette: 'SUBJECT',
  aimMode: 'CURSOR',
  shadows: true,
  seenTutorial: false,
});

function load(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...base, ...parsed };
    merged.name = sanitizeName(merged.name, base.name);
    return merged;
  } catch {
    return base;
  }
}

export const settingsStore = new Store<Settings>(load());

settingsStore.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsStore.get()));
  } catch {
    // Storage may be unavailable (private mode); settings then last for this tab only.
  }
});
