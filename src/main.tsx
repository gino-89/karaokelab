import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initUniversalTouchEngine } from './utils/touchEngine';

// Start universal 1-tap touch engine for iPadOS / iOS / touch devices
initUniversalTouchEngine();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

