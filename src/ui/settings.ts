// Remembering the settings (and the imported palette) in this browser.
// Storage can be missing or blocked (private windows, previews), so every
// access is guarded and the page works the same without it.

import { app, schedule } from './app';
import { $, field, radio, setRadio, setStatus } from './dom';
import { syncAll, syncPairs } from './controls';
import { renderImported, IMPORT_HINT } from './palettePanel';
import type { RGB } from '../core/color';

const PERSIST_IDS = ['cellX', 'cellY', 'square', 'offX', 'offY', 'snap', 'fw', 'fh', 'tol', 'colors', 'clean', 'cleanStr',
  'alpha', 'removeBg', 'bgTol', 'showGrid', 'scale', 'pixGrid', 'animOn', 'cols', 'rows', 'minGap', 'fps', 'onion',
  'repeatHolds', 'sheetCols', 'sheetPad', 'gifScale', 'batchPalette', 'cropPad', 'cropL', 'cropT', 'cropR', 'cropB'];
const PERSIST_RADIOS = ['sizeMode', 'palMode', 'bgMode', 'cropMode', 'splitMode', 'align', 'dir', 'endMode', 'ghost'];
const STORE_KEY = 'pixelize.settings.v1';

interface Saved {
  values: Record<string, string | boolean>;
  radios: Record<string, string>;
  imported?: RGB[];
}

function readControls(): Saved {
  const values: Saved['values'] = {}, radios: Saved['radios'] = {};
  for (const id of PERSIST_IDS) { const el = field(id); values[id] = el.type === 'checkbox' ? el.checked : el.value; }
  for (const name of PERSIST_RADIOS) radios[name] = radio(name);
  return { values, radios };
}

function writeControls(s: Saved): void {
  for (const [id, v] of Object.entries(s.values || {})) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
  }
  for (const [name, v] of Object.entries(s.radios || {})) setRadio(name, v);
  syncPairs();
}

let defaults: Saved | null = null;
let saveTimer = 0;

export function saveSettings(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...readControls(), imported: app.imported })); } catch { /* storage unavailable */ }
  }, 250);
}

function restoreSettings(): void {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as Saved | null;
    if (!s) return;
    writeControls(s);
    if (Array.isArray(s.imported)) app.imported = s.imported;
  } catch { /* storage unavailable or corrupt */ }
}

function resetSettings(): void {
  if (defaults) writeControls(defaults);
  app.imported = [];
  app.locks = [];
  app.colorMaps = [];
  app.bgPick = null;
  $('importInfo').textContent = IMPORT_HINT;
  renderImported();
  try { localStorage.removeItem(STORE_KEY); } catch { /* storage unavailable */ }
  syncAll();
  schedule();
  setStatus('Settings reset.');
}

/** Call before the other modules sync their controls. */
export function initSettings(): void {
  defaults = readControls();
  restoreSettings();
  $('resetSettings').addEventListener('click', resetSettings);
  document.addEventListener('input', saveSettings);
  document.addEventListener('change', saveSettings);
}
