// Entry point. Order matters: settings are restored before the controls sync,
// result listeners run in registration order (palette, editor, animation), and
// the steps start last so every module already listens to step changes.

import './styles.css';
import { app, schedule } from './ui/app';
import { startWorker, isBusy, usingWorker } from './ui/processing';
import { initSettings } from './ui/settings';
import { initControls } from './ui/controls';
import { initViews } from './ui/views';
import { initPalettePanel } from './ui/palettePanel';
import { initEditor } from './ui/editor';
import { initAnim, animState, animFrameCanvases } from './ui/anim';
import { initDownloads } from './ui/downloads';
import { initBatch, runBatch } from './ui/batch';
import { initInput, loadSample, sampleCanvas } from './ui/input';
import { goTo, initSteps } from './ui/steps';
import { currentMode, initMode, onMode, setMode } from './ui/mode';
import { initSprite, loadFrames, showSprite, spriteState } from './ui/sprite';
import { $ } from './ui/dom';

startWorker();
initSettings();
initControls();
initViews();
initPalettePanel();
initEditor();
initAnim();
initDownloads();
initBatch();
initInput();
initSteps();

// the sprite editor reads paste and drop events first while it is open
initSprite(() => currentMode() === 'sprite');
onMode((m) => { if (m === 'sprite') showSprite(); });
$('toSprite').addEventListener('click', () => {
  if (!app.result) return;
  if (loadFrames(animFrameCanvases() ?? [app.resultCanvas], app.source?.name || 'sprite')) setMode('sprite');
});
initMode();

// Handle for inspecting the page from the browser console.
Object.assign(window, { pixelize: { app, schedule, setMode, spriteState, isBusy, usingWorker, animState, runBatch, sampleCanvas, loadSample, goTo } });
