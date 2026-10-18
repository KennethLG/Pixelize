// Entry point. The state modules start first (settings before anything that
// reads them; the sprite editor's paste and drop handlers before the page-wide
// ones), then React renders the page.

import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Page } from './ui/Page';
import { animState, initAnim } from './ui/anim';
import { app, schedule } from './ui/app';
import { runBatch } from './ui/batch';
import { initDownloads } from './ui/downloads';
import { initEditor } from './ui/editor';
import { initInput, loadSample, sampleCanvas } from './ui/input';
import { currentMode, initMode, onMode, setMode } from './ui/mode';
import { initPalette } from './ui/palette';
import { isBusy, startWorker, usingWorker } from './ui/processing';
import { initSettings, settings } from './ui/settings';
import { initSprite, showSprite, spriteState } from './ui/sprite';
import { goTo, initSteps } from './ui/steps';

startWorker();
initSettings();
initPalette();
initEditor();
initAnim();
initDownloads();
// the sprite editor reads paste and drop events first while it is open
initSprite(() => currentMode() === 'sprite');
initInput();
initSteps();
onMode((m) => { if (m === 'sprite') showSprite(); });
initMode();

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);

// Handle for inspecting the page from the browser console.
Object.assign(window, { pixelize: { app, settings, schedule, setMode, spriteState, isBusy, usingWorker, animState, runBatch, sampleCanvas, loadSample, goTo } });
