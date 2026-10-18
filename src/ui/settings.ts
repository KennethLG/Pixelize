// Pixelize settings: one typed object instead of reading the form. Changes go
// through setSettings(), which announces them, saves them in this browser and
// reprocesses the image when they affect the result. Storage can be missing
// or blocked (private windows, previews), so every access is guarded.

import type { BgMode } from '../core/background';
import type { RGB } from '../core/color';
import type { CropMode } from '../core/crop';
import type { Direction } from '../core/frames';
import type { GridMode } from '../core/grid';
import type { PaletteMode } from '../core/pipeline';
import { app, pxBus, schedule } from './app';

export const DEFAULTS = {
  // pixels
  sizeMode: 'auto' as GridMode, cellX: 16, cellY: 16, square: true, offX: 0, offY: 0, snap: true, fw: 64, fh: 64,
  showGrid: true, alpha: 128,
  // colors
  palMode: 'auto' as PaletteMode, tol: 10, colors: 16, clean: false, cleanStr: 15,
  // background and crop
  removeBg: false, bgMode: 'edge' as BgMode, bgTol: 6,
  cropMode: 'off' as CropMode, cropPad: 0, cropT: 0, cropL: 0, cropR: 0, cropB: 0,
  // result view
  pixGrid: true, compare: false, split: 50,
  // animation
  animOn: true, splitMode: 'auto' as 'auto' | 'grid', cols: 4, rows: 1, minGap: 1, align: 'bottom' as 'bottom' | 'center',
  fps: 8, dir: 'forward' as Direction, endMode: 'loop' as 'loop' | 'once', onion: false, ghost: 'prev' as 'prev' | 'first' | 'none',
  // export
  scale: 8, gifScale: 4, sheetCols: 0, sheetPad: 0, repeatHolds: true, batchPalette: false,
};
export type Settings = typeof DEFAULTS;
export const settings: Settings = { ...DEFAULTS };

/** Settings that change the processed result. */
const PROCESS_KEYS = new Set<keyof Settings>(['sizeMode', 'cellX', 'cellY', 'square', 'offX', 'offY', 'snap', 'fw', 'fh', 'alpha',
  'palMode', 'tol', 'colors', 'clean', 'cleanStr', 'removeBg', 'bgMode', 'bgTol', 'cropMode', 'cropPad', 'cropT', 'cropL', 'cropR', 'cropB']);
/** Only for the current look; not remembered. */
const TRANSIENT = new Set<keyof Settings>(['compare', 'split']);

const STORE_KEY = 'pixelize.settings.v2';
const OLD_KEY = 'pixelize.settings.v1';

export function setSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  pxBus.emit('settings');
  saveSettings();
  if ((Object.keys(patch) as (keyof Settings)[]).some((k) => PROCESS_KEYS.has(k))) schedule();
}

let saveTimer = 0;
export function saveSettings(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const kept = Object.fromEntries(Object.entries(settings).filter(([k]) => !TRANSIENT.has(k as keyof Settings)));
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ settings: kept, imported: app.imported })); } catch { /* storage unavailable */ }
  }, 250);
}

/** Copies saved values over the defaults, keeping each one's type. */
function apply(values: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULTS)) continue;
    const def = DEFAULTS[k as keyof Settings];
    const val = typeof def === 'number' ? Number(v) : typeof def === 'boolean' ? v === true || v === 'true' : String(v);
    if (typeof def === 'number' && !Number.isFinite(val)) continue;
    (settings as Record<string, unknown>)[k] = val;
  }
}

function restoreSettings(): void {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as { settings?: Record<string, unknown>; imported?: RGB[] } | null;
    if (s) {
      apply(s.settings || {});
      if (Array.isArray(s.imported)) app.imported = s.imported;
      return;
    }
    // the first version saved the form fields by id and the radio groups by name
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null') as { values?: Record<string, unknown>; radios?: Record<string, unknown>; imported?: RGB[] } | null;
    if (old) {
      apply({ ...old.values, ...old.radios });
      if (Array.isArray(old.imported)) app.imported = old.imported;
    }
  } catch { /* storage unavailable or corrupt */ }
}

export function resetSettings(): void {
  Object.assign(settings, DEFAULTS);
  app.imported = [];
  app.locks = [];
  app.colorMaps = [];
  app.bgPick = null;
  try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(OLD_KEY); } catch { /* storage unavailable */ }
  pxBus.emit('settings', 'palette');
  schedule();
}

/** Copies the detected grid into Manual so it can be fine-tuned. */
export function toManual(): void {
  const g = app.base?.grid;
  const patch: Partial<Settings> = { sizeMode: 'manual' };
  if (g?.cell) {
    const c = Math.round(g.cell.x * 10) / 10;
    const off = (cuts: number[]) => (cuts.length > 2 ? ((cuts[1] % c) + c) % c : 0);
    Object.assign(patch, { cellX: c, cellY: c, offX: Math.round(off(g.xs) * 2) / 2, offY: Math.round(off(g.ys) * 2) / 2, square: true });
  }
  setSettings(patch);
}

/** Call first: the other modules start from these values. */
export function initSettings(): void {
  restoreSettings();
}
