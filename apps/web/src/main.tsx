import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { initTheme } from './lib/theme.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/games.css';
import './styles/pages.css';

initTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root mancante');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
