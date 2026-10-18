// The result's palette: selecting a color, locking, replacing and merging it,
// and the imported palette of the Colors step. Changes emit 'palette'.

import { hex, keyAt, keyOf, rgbOfKey, type RGB } from '../core/color';
import { parsePaletteText } from '../core/paletteText';
import { app, pxBus, schedule } from './app';
import { setStatus } from './dom';
import { setDrawColor } from './editor';
import { decodeFile, imageToData } from './input';
import { saveSettings, setSettings } from './settings';

export const IMPORT_HINT = 'Load a PNG, .hex or .gpl palette (Lospec exports work), or paste hex codes. Every pixel snaps to the nearest color.';

/** The swatch being edited, and the color being merged (waiting for its target). */
export const pal = { selected: null as number | null, mergeFrom: null as number | null, importInfo: '' };

export const isLocked = (key: number) => app.locks.some((l) => keyOf(l[0], l[1], l[2]) === key);

export function onSwatch(key: number): void {
  if (pal.mergeFrom !== null) {
    if (key !== pal.mergeFrom) {
      app.colorMaps.push({ from: rgbOfKey(pal.mergeFrom), to: rgbOfKey(key) });
      pal.selected = key;
      schedule();
    }
    pal.mergeFrom = null;
    pxBus.emit('palette');
    return;
  }
  pal.selected = key;
  setDrawColor(rgbOfKey(key));
  pxBus.emit('palette');
}

export function toggleLock(): void {
  const key = pal.selected;
  if (key === null) return;
  if (isLocked(key)) app.locks = app.locks.filter((l) => keyOf(l[0], l[1], l[2]) !== key);
  else app.locks.push(rgbOfKey(key));
  pxBus.emit('palette');
  schedule();
}

export function replaceSelected(to: RGB): void {
  const from = pal.selected;
  if (from === null) return;
  app.colorMaps.push({ from: rgbOfKey(from), to });
  // a locked color keeps its lock under its new value
  app.locks = app.locks.map((l) => (keyOf(l[0], l[1], l[2]) === from ? to : l));
  pal.selected = keyOf(to[0], to[1], to[2]);
  pxBus.emit('palette');
  schedule();
}

export function toggleMerge(): void {
  pal.mergeFrom = pal.mergeFrom === null ? pal.selected : null;
  pxBus.emit('palette');
}

export function resetColorChanges(): void {
  app.locks = [];
  app.colorMaps = [];
  pal.mergeFrom = null;
  pxBus.emit('palette');
  schedule();
}

export function copyText(text: string): void {
  try { navigator.clipboard.writeText(text).then(() => setStatus(`Copied ${text.length > 40 ? 'the palette' : text}`), () => setStatus(`Couldn't copy. ${text}`, true)); }
  catch { setStatus(`Couldn't copy. ${text}`, true); }
}

export const copySelected = () => { if (pal.selected !== null) copyText(hex(rgbOfKey(pal.selected))); };
export const copyAll = () => copyText(app.resultColors.map((c) => hex(c.rgb)).join(' '));

// ---------- imported palette ----------

export function setImported(cols: RGB[], from: string): void {
  if (!cols.length) { setStatus('No colors found in that palette.', true); return; }
  app.imported = cols;
  pal.importInfo = `${cols.length} colors from ${from}. Every pixel snaps to the nearest one.`;
  pxBus.emit('palette');
  saveSettings();
  setSettings({ palMode: 'imported' });
  schedule();
}

export async function importPaletteFile(file: File): Promise<void> {
  let cols: RGB[];
  if (file.type.startsWith('image/')) {
    const { data } = imageToData(await decodeFile(file));
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) { const k = keyAt(data, i); counts.set(k, (counts.get(k) || 0) + 1); }
    cols = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map((e) => rgbOfKey(e[0]));
  } else {
    cols = parsePaletteText(await file.text());
  }
  setImported(cols, file.name);
}

export const applyPastedCodes = (text: string) => setImported(parsePaletteText(text), 'pasted codes');
export const useResultColors = () => { if (app.resultColors.length) setImported(app.resultColors.map((c) => c.rgb), 'the current result'); };

export function initPalette(): void {
  pal.importInfo = app.imported.length ? `${app.imported.length} colors. Every pixel snaps to the nearest one.` : IMPORT_HINT;
  pxBus.on('source', () => { pal.selected = null; pal.mergeFrom = null; });
  pxBus.on('result', () => {
    if (pal.selected !== null && !app.resultColors.some((c) => c.key === pal.selected)) { pal.selected = null; pxBus.emit('palette'); }
  });
  pxBus.on('settings', () => { if (!app.imported.length && pal.importInfo !== IMPORT_HINT) { pal.importInfo = IMPORT_HINT; pxBus.emit('palette'); } });
}
