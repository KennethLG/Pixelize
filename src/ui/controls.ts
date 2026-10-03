// The processing settings in the left column: which rows show for each mode,
// the number + slider pairs, and reprocessing when anything changes.

import { app, schedule } from './app';
import { $, field, isChecked, num, onAll, radio, setRadio } from './dom';
import { saveSettings } from './settings';

const PAIRS: [string, string][] = [['cellX', 'cellXr'], ['cellY', 'cellYr'], ['offX', 'offXr'], ['offY', 'offYr']];

export function setPair(id: string, v: number): void {
  field(id).value = String(v);
  const p = PAIRS.find((q) => q[0] === id);
  if (p) field(p[1]).value = String(v);
}

export function syncPairs(): void {
  for (const [n, r] of PAIRS) field(r).value = field(n).value;
  field('offXr').max = String(Math.max(1, num('cellX') || 16));
  field('offYr').max = String(Math.max(1, (isChecked('square') ? num('cellX') : num('cellY')) || 16));
}

export function syncModes(): void {
  const size = radio('sizeMode');
  $('autoBox').hidden = size !== 'auto';
  $('manualBox').hidden = size !== 'manual';
  $('exactBox').hidden = size !== 'exact';
  $('cellYRow').hidden = isChecked('square');
  const pal = radio('palMode');
  $('tolRow').hidden = pal !== 'auto';
  $('colorsRow').hidden = pal !== 'fixed';
  $('importBox').hidden = pal !== 'imported';
  $('palHint').hidden = pal === 'imported';
  $('palHint').textContent = pal === 'fixed'
    ? 'Groups every shade into exactly this many colors.'
    : 'Move it right to merge more shades and get fewer colors.';
  $('cleanRow').hidden = !isChecked('clean');
  $('bgBox').classList.toggle('dim', !isChecked('removeBg'));
  const crop = radio('cropMode');
  $('trimBox').hidden = crop !== 'trim';
  $('manualCropBox').hidden = crop !== 'manual';
  // the offset only places lines when they are not snapping to edges
  for (const id of ['offX', 'offXr', 'offY', 'offYr']) field(id).disabled = isChecked('snap');
  for (const [out, src] of [['tolOut', 'tol'], ['cleanOut', 'cleanStr'], ['alphaOut', 'alpha'], ['bgTolOut', 'bgTol'], ['fpsOut', 'fps']]) {
    $(out).textContent = field(src).value;
  }
  field('split').disabled = !isChecked('compare');
}

export function syncSplit(): void {
  const grid = radio('splitMode') === 'grid';
  $('gridRow').hidden = !grid;
  $('autoRows').hidden = grid;
  $('splitHint').textContent = grid
    ? 'Splits the result into equal parts, left to right and top to bottom.'
    : 'Finds each frame by the empty space around it.';
}

export function syncAll(): void {
  syncPairs();
  syncModes();
  syncSplit();
}

// Copy the detected grid into Manual so it can be fine-tuned.
export function toManual(): void {
  const g = app.base?.grid;
  if (g?.cell) {
    const c = Math.round(g.cell.x * 10) / 10;
    const off = (cuts: number[]) => (cuts.length > 2 ? ((cuts[1] % c) + c) % c : 0);
    setPair('cellX', c);
    setPair('cellY', c);
    setPair('offX', Math.round(off(g.xs) * 2) / 2);
    setPair('offY', Math.round(off(g.ys) * 2) / 2);
    field('square').checked = true;
  }
  setRadio('sizeMode', 'manual');
  syncAll();
  saveSettings();
  schedule();
}

export function initControls(): void {
  for (const [n, r] of PAIRS) {
    field(n).addEventListener('input', () => { field(r).value = field(n).value; syncPairs(); schedule(); });
    field(r).addEventListener('input', () => { field(n).value = field(r).value; syncPairs(); schedule(); });
  }
  onAll('input[name="sizeMode"], input[name="palMode"], input[name="bgMode"], input[name="cropMode"]', 'change', () => { syncModes(); schedule(); });
  for (const id of ['fw', 'fh', 'colors', 'alpha', 'tol', 'cleanStr', 'bgTol', 'cropPad', 'cropL', 'cropT', 'cropR', 'cropB']) field(id).addEventListener('input', () => { syncModes(); schedule(); });
  for (const id of ['square', 'snap', 'clean', 'removeBg']) field(id).addEventListener('change', () => { syncAll(); schedule(); });
  $('toManual').addEventListener('click', toManual);
  $('warnManual').addEventListener('click', toManual);
  $('bgAuto').addEventListener('click', () => { app.bgPick = null; schedule(); });
  syncAll();
}
