import { useEffect, useRef, useState } from 'react';
import { appStore, GameApp, go } from '../game/GameApp';
import { audio } from '../game/audio/AudioEngine';
import { net } from '../networking/NetClient';
import { settingsStore } from '../state/settings';
import { useStore } from '../state/store';
import { Hud } from './screens/Hud';
import { HowToPlay } from './screens/HowToPlay';
import { MainMenu } from './screens/MainMenu';
import { Lobby, OnlineMenu } from './screens/OnlineScreens';
import { SettingsPanel } from './screens/SettingsScreen';
import { SoloSetup } from './screens/SoloSetup';

let gamePromise: Promise<GameApp> | null = null;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<GameApp | null>(null);
  const app = useStore(appStore);
  const netState = useStore(net.store);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    // StrictMode mounts effects twice in development; the world must only be built once.
    gamePromise ??= GameApp.create(canvas);
    void gamePromise.then((g) => {
      if (!cancelled) setGame(g);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A match that ends while we are in the lobby (online) keeps the lobby in sync.
  useEffect(() => {
    if (app.screen === 'lobby' && !netState.room) go('menu');
  }, [app.screen, netState.room]);

  const quickPlay = async (): Promise<string | null> => {
    const ok = await net.connect(settingsStore.get().name);
    if (!ok) return net.store.get().error ?? 'SERVER OFFLINE';
    const res = await net.quickPlay();
    if (!res.ok) return res.error;
    go('lobby');
    return null;
  };

  const inGame = app.screen === 'game';

  return (
    <>
      <canvas ref={canvasRef} className={`world ${inGame ? 'in-game' : ''}`} tabIndex={0} onPointerDown={() => audio.unlock()} onContextMenu={(e) => e.preventDefault()} />

      {app.loading ? (
        <div className="loading">
          <div>{app.loading}</div>
          <div className="bar" />
        </div>
      ) : null}

      {game && app.screen === 'menu' ? <MainMenu onQuickPlay={quickPlay} /> : null}
      {game && app.screen === 'solo' ? (
        <SoloSetup
          onStart={(c) => {
            audio.unlock();
            game.startSolo({ name: settingsStore.get().name, skin: settingsStore.get().skin, bots: c.bots, difficulty: c.difficulty, config: c.config });
          }}
        />
      ) : null}
      {game && app.screen === 'online' ? <OnlineMenu /> : null}
      {game && app.screen === 'lobby' ? <Lobby /> : null}
      {game && app.screen === 'howto' ? <HowToPlay onClose={() => go(app.back === 'howto' ? 'menu' : app.back)} /> : null}
      {game && app.screen === 'settings' ? (
        <div className="screen-center">
          <SettingsPanel onClose={() => go(app.back === 'settings' ? 'menu' : app.back)} />
        </div>
      ) : null}

      {game && inGame ? (
        <Hud
          actions={{
            onResume: () => game.setPaused(false),
            onQuit: () => game.quitToMenu(),
            onPlayAgain: () => game.playAgain(),
          }}
        />
      ) : null}

      {netState.notice && app.screen === 'game' ? <div className="toast">{netState.notice}</div> : null}
    </>
  );
}
