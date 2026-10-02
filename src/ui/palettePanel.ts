// The palette panel (colors in the result, lock / replace / merge) and the
// imported palette controls in the Colors section.

import { hex, hexToRgb, keyAt, keyOf, labOfKey, rgbOfKey, type RGB } from '../core/color';
import { parsePaletteText } from '../core/paletteText';
import { app, onResult, schedule } from './app';
import { $, field, radio, setRadio, setStatus } from './dom';
import { syncModes } from './controls';
import { saveSettings } from './settings';
import { setDrawColor } from './editor';
import { decodeFile, imageToData } from './input';

export const IMPORT_HINT = 'Load a PNG, .hex or .gpl palette (Lospec exports work), or paste hex codes. Every pixel snaps to the nearest color.';

let selected: number | null = null;
let mergeFrom: number | null = null;

const isLocked = (key: number) => app.locks.some((l) => keyOf(l[0], l[1], l[2]) === key);

function computeResultColors(): void {
  const counts = new Map<number, number>();
  const px = app.result!.pixels;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3]) { const k = keyAt(px, i); counts.set(k, (counts.get(k) || 0) + 1); }
  app.resultColors = [...counts.entries()]
    .map(([key, count]) => ({ key, rgb: rgbOfKey(key), count, l: labOfKey(key)[0] }))
    .sort((a, b) => a.l - b.l);
}

export function renderPalette(): void {
  if (!app.result) return;
  computeResultColors();
  $('stPal').textContent = String(app.resultColors.length);
  if (selected !== null && !app.resultColors.some((c) => c.key === selected)) selected = null;
  $('swatches').replaceChildren(...app.resultColors.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw' + (c.key === selected ? ' sel' : '') + (mergeFrom !== null && c.key !== mergeFrom ? ' target' : '');
    b.title = `${hex(c.rgb)} · ${c.count} px`;
    const i = document.createElement('i');
    i.style.background = hex(c.rgb);
    b.append(i, hex(c.rgb));
    if (isLocked(c.key)) { const l = document.createElement('b'); l.textContent = 'LOCK'; b.append(l); }
    b.addEventListener('click', () => onSwatch(c.key));
    return b;
  }));
  const sel = app.resultColors.find((c) => c.key === selected);
  $('swEditor').hidden = !sel;
  if (sel) {
    const importedMode = radio('palMode') === 'imported';
    $('swInfo').textContent = mergeFrom !== null ? `Click the color to merge ${hex(sel.rgb)} into` : `${hex(sel.rgb)} · ${sel.count} px`;
    $('swLock').textContent = isLocked(sel.key) ? 'Unlock' : 'Lock';
    $('swMerge').textContent = mergeFrom !== null ? 'Cancel merge' : 'Merge into…';
    // in palette mode the imported colors are the palette; editing them here would not stick
    for (const id of ['swLock', 'swMerge', 'swReplace']) field(id).disabled = importedMode;
    field('swReplace').value = hex(sel.rgb);
  }
  $('palReset').hidden = !app.locks.length && !app.colorMaps.length;
}

function onSwatch(key: number): void {
  if (mergeFrom !== null) {
    if (key !== mergeFrom) {
      app.colorMaps.push({ from: rgbOfKey(mergeFrom), to: rgbOfKey(key) });
      selected = key;
      schedule();
    }
    mergeFrom = null;
    renderPalette();
    return;
  }
  selected = key;
  setDrawColor(rgbOfKey(key));
  renderPalette();
}

export function copyText(text: string, el: HTMLElement): void {
  const fallback = () => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    setStatus('Press Ctrl+C to copy the selection.');
  };
  try { navigator.clipboard.writeText(text).then(() => setStatus(`Copied ${text.length > 40 ? 'the palette' : text}`), fallback); }
  catch { fallback(); }
}

// ---------- imported palette ----------

export function renderImported(): void {
  $('importSwatches').replaceChildren(...app.imported.map((c) => {
    const i = document.createElement('i');
    i.style.background = hex(c);
    i.title = hex(c);
    return i;
  }));
}

function setImported(cols: RGB[], from: string): void {
  if (!cols.length) { setStatus('No colors found in that palette.', true); return; }
  app.imported = cols;
  $('importInfo').textContent = `${cols.length} colors from ${from}. Every pixel snaps to the nearest one.`;
  renderImported();
  setRadio('palMode', 'imported');
  syncModes();
  saveSettings();
  schedule();
}

async function importPaletteFile(file: File): Promise<void> {
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

export function initPalettePanel(): void {
  onResult(renderPalette);
  if (app.imported.length) $('importInfo').textContent = `${app.imported.length} colors. Every pixel snaps to the nearest one.`;
  renderImported();

  $('swCopy').addEventListener('click', () => { if (selected !== null) copyText(hex(rgbOfKey(selected)), $('swInfo')); });
  $('swLock').addEventListener('click', () => {
    if (selected === null) return;
    const key = selected;
    if (isLocked(key)) app.locks = app.locks.filter((l) => keyOf(l[0], l[1], l[2]) !== key);
    else app.locks.push(rgbOfKey(key));
    schedule();
  });
  field('swReplace').addEventListener('change', () => {
    if (selected === null) return;
    const from = selected, to = hexToRgb(field('swReplace').value);
    app.colorMaps.push({ from: rgbOfKey(from), to });
    // a locked color keeps its lock under its new value
    app.locks = app.locks.map((l) => (keyOf(l[0], l[1], l[2]) === from ? to : l));
    selected = keyOf(to[0], to[1], to[2]);
    schedule();
  });
  $('swMerge').addEventListener('click', () => { mergeFrom = mergeFrom === null ? selected : null; renderPalette(); });
  $('palReset').addEventListener('click', () => { app.locks = []; app.colorMaps = []; mergeFrom = null; schedule(); });
  $('copyAllHex').addEventListener('click', () => copyText(app.resultColors.map((c) => hex(c.rgb)).join(' '), $('swatches')));

  $('palFileBtn').addEventListener('click', () => field('palFile').click());
  field('palFile').addEventListener('change', async () => {
    const f = field('palFile').files?.[0];
    field('palFile').value = '';
    if (!f) return;
    try { await importPaletteFile(f); } catch (err) { setStatus(err instanceof Error ? err.message : "Couldn't read that palette.", true); }
  });
  $('palApply').addEventListener('click', () => setImported(parsePaletteText(field('palText').value), 'pasted codes'));
  field('palText').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('palApply').click(); });
  $('useResultPal').addEventListener('click', () => {
    if (app.resultColors.length) setImported(app.resultColors.map((c) => c.rgb), 'the current result');
  });
}
