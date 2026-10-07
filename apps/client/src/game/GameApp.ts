import type { MatchView } from '@blindshot/shared';
import { ClientWorld } from './core/ClientWorld';
import { GameController } from './core/GameController';
import { MenuDirector } from './core/MenuDirector';
import { LocalSession, type SoloOptions } from '../networking/LocalSession';
import { net } from '../networking/NetClient';
import { NetSession } from '../networking/NetSession';
import { Store } from '../state/store';

export type Screen = 'boot' | 'menu' | 'solo' | 'online' | 'lobby' | 'howto' | 'settings' | 'game';

export interface AppState {
  screen: Screen;
  /** Where SETTINGS / HOW TO PLAY return to. */
  back: Screen;
  loading: string | null;
}

export const appStore = new Store<AppState>({ screen: 'boot', back: 'menu', loading: 'BOOTING TEST FACILITY' });

export const go = (screen: Screen): void => {
  const current = appStore.get().screen;
  appStore.set({ screen, back: screen === 'settings' || screen === 'howto' ? current : appStore.get().back });
};

/** Glue between the 3D world, the menus and the match controller. */
export class GameApp {
  private controller: GameController | null = null;
  private readonly menu: MenuDirector;
  private lastSolo: SoloOptions | null = null;

  private constructor(readonly world: ClientWorld) {
    this.menu = new MenuDirector(world);
    net.onMatchStarted((view) => this.startOnline(view));
  }

  static async create(canvas: HTMLCanvasElement): Promise<GameApp> {
    // Canvas textures use the display fonts — make sure they are ready first.
    try {
      await Promise.race([
        Promise.all([document.fonts.load('64px Anton'), document.fonts.load('700 32px "Barlow Condensed"')]),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch {
      // Fallback fonts are fine.
    }
    const world = new ClientWorld(canvas);
    const app = new GameApp(world);
    appStore.set({ loading: 'CALIBRATING PHYSICS' });
    try {
      await world.initPhysics();
    } catch (e) {
      console.warn('Physics unavailable, ragdolls disabled', e);
    }
    world.start();
    app.menu.start();
    if (import.meta.env.DEV) (window as unknown as { __blindshot: GameApp }).__blindshot = app;
    appStore.set({ screen: 'menu', loading: null });
    return app;
  }

  get inMatch(): boolean {
    return this.controller !== null;
  }

  startSolo(opts: SoloOptions): void {
    this.lastSolo = opts;
    this.launch(() => new GameController(this.world, new LocalSession(opts)));
  }

  startOnline(view: MatchView): void {
    const { socket, store } = net;
    const playerId = store.get().playerId;
    if (!socket || !playerId) return;
    const code = store.get().room?.code ?? null;
    this.launch(() => new GameController(this.world, new NetSession(socket, playerId, view), code));
  }

  /** PLAY AGAIN: same solo setup, or back to the room lobby online. */
  playAgain(): void {
    if (this.controller && net.store.get().room) {
      this.endMatch();
      go('lobby');
      return;
    }
    if (this.lastSolo) this.startSolo(this.lastSolo);
  }

  setPaused(paused: boolean): void {
    this.controller?.setPaused(paused);
  }

  quitToMenu(): void {
    const online = !!net.store.get().room;
    this.endMatch();
    if (online) net.leaveRoom();
    go('menu');
  }

  endMatch(): void {
    this.controller?.dispose();
    this.controller = null;
    this.menu.start();
  }

  private launch(make: () => GameController): void {
    this.controller?.dispose();
    this.menu.stop();
    this.controller = make();
    go('game');
  }
}
