// Entry point. Order matters: settings are restored before the controls sync,
// and result listeners run in registration order (palette, editor, animation).

import './styles.css';
import { app, schedule } from './ui/app';
import { startWorker, isBusy, usingWorker } from './ui/processing';
import { initSettings } from './ui/settings';
import { initControls } from './ui/controls';
import { initViews } from './ui/views';
import { initPalettePanel } from './ui/palettePanel';
import { initEditor } from './ui/editor';
import { initAnim, animState } from './ui/anim';
import { initDownloads } from './ui/downloads';
import { initBatch, runBatch } from './ui/batch';
import { initInput, loadSample, sampleCanvas } from './ui/input';

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
loadSample();

// Handle for inspecting the page from the browser console.
Object.assign(window, { pixelize: { app, schedule, isBusy, usingWorker, animState, runBatch, sampleCanvas } });
