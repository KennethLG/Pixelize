// App state and the processing loop. UI modules subscribe to three moments:
// a new source image, a new processed base (settings changed), and a new
// result (base plus pixel edits). Edits only trigger the last one.

import type { RGB, RGBA } from '../core/color';
import type { ColorMap } from '../core/palette';
import type { BgMode } from '../core/background';
import type { GridMode } from '../core/grid';
import type { BgPick, PaletteMode, ProcessOptions, ProcessResult } from '../core/pipeline';
import { dropSource, processAsync, type WorkSource } from './processing';
import { int, isChecked, num, radio, setStatus } from './dom';

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
  resultColors: [] as ResultColor[],
};

type Listener = () => void;
const listeners = { source: [] as Listener[], base: [] as Listener[], result: [] as Listener[] };
export const onSource = (fn: Listener) => listeners.source.push(fn);
export const onBase = (fn: Listener) => listeners.base.push(fn);
export const onResult = (fn: Listener) => listeners.result.push(fn);

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
  listeners.source.forEach((f) => f());
  schedule(0);
}

export function collectOpts(): ProcessOptions {
  const square = isChecked('square');
  return {
    size: {
      mode: radio<GridMode>('sizeMode'),
      cellX: num('cellX'),
      cellY: square ? num('cellX') : num('cellY'),
      offX: num('offX') || 0,
      offY: num('offY') || 0,
      snap: isChecked('snap'),
      fw: int('fw'),
      fh: int('fh'),
    },
    alpha: int('alpha'),
    palette: { mode: radio<PaletteMode>('palMode'), tol: num('tol'), count: int('colors'), imported: app.imported, locks: app.locks, maps: app.colorMaps },
    clean: { on: isChecked('clean'), strength: num('cleanStr') },
    bg: { on: isChecked('removeBg'), mode: radio<BgMode>('bgMode'), tol: num('bgTol'), pick: app.bgPick },
  };
}

let runSeq = 0;
let timer = 0;

/** Reprocess the source with the current settings (debounced). */
export function schedule(delay = 80): void {
  clearTimeout(timer);
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
  listeners.base.forEach((f) => f());
  listeners.result.forEach((f) => f());
}

/** Base pixels with the edits applied, also drawn into resultCanvas. */
export function composeResult(): void {
  const base = app.base!;
  const px = new Uint8ClampedArray(base.pixels);
  for (const [i, c] of app.edits) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3]; }
  app.result = { width: base.width, height: base.height, pixels: px };
  app.resultCanvas.width = base.width;
  app.resultCanvas.height = base.height;
  app.resultCanvas.getContext('2d')!.putImageData(new ImageData(px, base.width, base.height), 0, 0);
}

export function commitEdits(): void {
  composeResult();
  listeners.result.forEach((f) => f());
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
onSource(clearHistory);
