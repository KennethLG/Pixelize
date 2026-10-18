// Pixelize state and the processing loop. Modules and components follow it
// through pxBus events:
//   source    a new image was loaded
//   base      a new processed result (settings changed)
//   result    the result changed (new base, or pixel edits)
//   settings  a setting changed (settings.ts)
//   step      the open step changed (steps.ts)
//   editor    the result editor's tool, color, zoom or history changed
//   anim      frames, their order, selection or playback changed
//   palette   palette selection, locks, replacements or the imported palette changed
//   mode      Pixelize / Sprite editor switched (mode.ts)

import { keyAt, labOfKey, rgbOfKey, type RGB, type RGBA } from '../core/color';
import type { ColorMap } from '../core/palette';
import type { BgPick, ProcessOptions, ProcessResult } from '../core/pipeline';
import { createBus } from './bus';
import { setStatus } from './dom';
import { dropSource, processAsync, type WorkSource } from './processing';
import { settings } from './settings';

export const pxBus = createBus<'source' | 'base' | 'result' | 'settings' | 'step' | 'editor' | 'anim' | 'palette' | 'mode'>();

export interface Source extends WorkSource {
  img: HTMLCanvasElement;
  name: string;
  isSample: boolean;
}

export interface Result {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface ResultColor {
  key: number;
  rgb: RGB;
  count: number;
  /** Lab lightness, for sorting dark to light. */
  l: number;
}

export type Edits = Map<number, RGBA>;

export const app = {
  source: null as Source | null,
  base: null as ProcessResult | null,
  result: null as Result | null,
  /** The result at 1× (edits included), drawn by the editor and the exports. */
  resultCanvas: document.createElement('canvas'),
  /** Pixel edits by byte index into the result. */
  edits: new Map() as Edits,
  editDims: '',
  bgPick: null as BgPick | null,
  locks: [] as RGB[],
  colorMaps: [] as ColorMap[],
  imported: [] as RGB[],
  /** The result's colors, dark to light. */
  resultColors: [] as ResultColor[],
};

export const onSource = (fn: () => void) => pxBus.on('source', fn);
export const onBase = (fn: () => void) => pxBus.on('base', fn);
export const onResult = (fn: () => void) => pxBus.on('result', fn);

let srcSeq = 0;
export const nextSourceId = () => ++srcSeq;

export function setSource(s: Omit<Source, 'id'>): void {
  dropSource(app.source);
  app.source = { id: nextSourceId(), ...s };
  app.base = null;
  app.result = null;
  app.bgPick = null;
  app.locks = [];
  app.colorMaps = [];
  app.edits = new Map();
  app.editDims = '';
  clearHistory();
  pxBus.emit('source', 'palette');
  schedule(0);
}

export function collectOpts(): ProcessOptions {
  const s = settings;
  return {
    size: {
      mode: s.sizeMode,
      cellX: s.cellX,
      cellY: s.square ? s.cellX : s.cellY,
      offX: s.offX || 0,
      offY: s.offY || 0,
      snap: s.snap,
      fw: Math.round(s.fw),
      fh: Math.round(s.fh),
    },
    alpha: Math.round(s.alpha),
    palette: { mode: s.palMode, tol: s.tol, count: Math.round(s.colors), imported: app.imported, locks: app.locks, maps: app.colorMaps },
    clean: { on: s.clean, strength: s.cleanStr },
    bg: { on: s.removeBg, mode: s.bgMode, tol: s.bgTol, pick: app.bgPick },
    crop: {
      mode: s.cropMode, pad: Math.round(s.cropPad) || 0,
      left: Math.round(s.cropL) || 0, top: Math.round(s.cropT) || 0, right: Math.round(s.cropR) || 0, bottom: Math.round(s.cropB) || 0,
    },
  };
}

let runSeq = 0;
let timer = 0;

/** Reprocess the source with the current settings (debounced). */
export function schedule(delay = 80): void {
  clearTimeout(timer);
  if (!app.source) return;
  setStatus('Processing…');
  timer = window.setTimeout(run, delay);
}

async function run(): Promise<void> {
  if (!app.source) return;
  const seq = ++runSeq;
  try {
    const out = await processAsync(app.source, collectOpts());
    if (seq !== runSeq) return;
    setStatus('');
    setBase(out);
  } catch (err) {
    if (seq === runSeq) setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

function setBase(out: ProcessResult): void {
  app.base = out;
  const dims = `${out.width}x${out.height}`;
  if (app.edits.size && dims !== app.editDims) {
    app.edits = new Map();
    clearHistory();
    setStatus('Your pixel edits were cleared because the output size changed.');
  }
  app.editDims = dims;
  composeResult();
  pxBus.emit('base', 'result');
}

/** Base pixels with the edits applied, also drawn into resultCanvas; and the colors it uses. */
export function composeResult(): void {
  const base = app.base!;
  const px = new Uint8ClampedArray(base.pixels);
  for (const [i, c] of app.edits) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3]; }
  app.result = { width: base.width, height: base.height, pixels: px };
  app.resultCanvas.width = base.width;
  app.resultCanvas.height = base.height;
  app.resultCanvas.getContext('2d')!.putImageData(new ImageData(px, base.width, base.height), 0, 0);
  const counts = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) if (px[i + 3]) { const k = keyAt(px, i); counts.set(k, (counts.get(k) || 0) + 1); }
  app.resultColors = [...counts.entries()]
    .map(([key, count]) => ({ key, rgb: rgbOfKey(key), count, l: labOfKey(key)[0] }))
    .sort((a, b) => a.l - b.l);
}

export function commitEdits(): void {
  composeResult();
  pxBus.emit('result', 'editor');
}

// ---------- undo history of pixel edits ----------

const undoStack: Edits[] = [];
let redoStack: Edits[] = [];

export function pushUndo(): void {
  undoStack.push(new Map(app.edits));
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}
export function undo(): void {
  if (!undoStack.length) return;
  redoStack.push(app.edits);
  app.edits = undoStack.pop()!;
  commitEdits();
}
export function redo(): void {
  if (!redoStack.length) return;
  undoStack.push(app.edits);
  app.edits = redoStack.pop()!;
  commitEdits();
}
export function clearHistory(): void {
  undoStack.length = 0;
  redoStack = [];
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
