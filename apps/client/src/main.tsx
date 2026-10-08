import '@fontsource/anton/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

// Dev only: a hot module update would rebuild the React tree around a game world that is
// still running, spawning a second world (the menu appears over a live match and its music
// keeps playing). A game is stateful, so always do a clean full reload instead.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => location.reload());
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
