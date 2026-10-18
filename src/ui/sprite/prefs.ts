// Editor preferences kept in this browser: paper, grid and the user's palette.

import { hex, hexToRgb, keyOf, type RGB } from '../../core/color';
import { emit, on, sp } from './state';

const PAPER_KEY = 'pixelize.sprite.paper';
const GRID_KEY = 'pixelize.sprite.grid';
const PAL_KEY = 'pixelize.sprite.palette';
const ONION_KEY = 'pixelize.sprite.onion';
const RAMPS_KEY = 'pixelize.sprite.ramps';
const LOCK_KEY = 'pixelize.sprite.lock';
const DEFAULT_PALETTE = ['#1b1530', '#5a5470', '#a8a4b8', '#f4f1e8', '#7a2d3a', '#d9732b', '#f0c060', '#3f7a4a'];

/** The user's own palette. Change it with the functions below so it is saved and shown. */
export let userPalette: RGB[] = [];
/** Saved color ramps, dark to light: the shading brush steps along them. */
export let ramps: RGB[][] = [];

/** What the shading brush uses: the saved ramps, or the palette in its order when there are none. */
export const shadeRamps = (): RGB[][] => (ramps.length ? ramps : userPalette.length ? [userPalette] : []);

const read = <T>(key: string): T | null => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};
const isHex = (h: unknown): h is string => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
export const clampGrid = (v: number) => Math.max(1, Math.min(512, Math.round(v) || 1));

function savePalette(): void {
  write(PAL_KEY, userPalette.map((c) => hex(c)));
  emit('palette');
}

export function addToPalette(cols: RGB[]): void {
  const have = new Set(userPalette.map((c) => keyOf(...c)));
  const next = [...userPalette];
  for (const c of cols) if (!have.has(keyOf(...c))) { next.push(c); have.add(keyOf(...c)); }
  userPalette = next;
  savePalette();
}

export function removeFromPalette(i: number): void {
  userPalette = userPalette.filter((_, k) => k !== i);
  savePalette();
}

export function clearPalette(): void {
  userPalette = [];
  savePalette();
}

function saveRamps(): void {
  write(RAMPS_KEY, ramps.map((r) => r.map((c) => hex(c))));
  emit('palette');
}
export function addRamp(r: RGB[]): void { ramps = [...ramps, r]; saveRamps(); }
export function removeRamp(i: number): void { ramps = ramps.filter((_, k) => k !== i); saveRamps(); }

export function setPaletteLock(on: boolean): void {
  sp.paletteLock = on;
  write(LOCK_KEY, on);
  emit('palette', 'tool');
}

export function loadPrefs(): void {
  const paper = read<{ mode: string; color: string }>(PAPER_KEY);
  if (paper?.mode === 'color' || paper?.mode === 'checker') sp.paperMode = paper.mode;
  if (isHex(paper?.color)) sp.paperColor = hexToRgb(paper!.color);
  const grid = read<{ w: number; h: number; show?: boolean }>(GRID_KEY);
  if (grid) { sp.gridW = clampGrid(grid.w); sp.gridH = clampGrid(grid.h); sp.showGrid = grid.show !== false; }
  const pal = read<unknown[]>(PAL_KEY);
  userPalette = Array.isArray(pal) && pal.length ? pal.filter(isHex).map(hexToRgb) : DEFAULT_PALETTE.map(hexToRgb);

  const savedRamps = read<unknown[]>(RAMPS_KEY);
  if (Array.isArray(savedRamps)) ramps = savedRamps.filter(Array.isArray).map((r) => (r as unknown[]).filter(isHex).map(hexToRgb)).filter((r) => r.length > 1);
  sp.paletteLock = read<boolean>(LOCK_KEY) === true;
  const onion = read<{ before: number; after: number; opacity: number; tint: boolean }>(ONION_KEY);
  if (onion) {
    sp.onionBefore = Math.max(0, Math.min(5, Math.round(onion.before) || 0));
    sp.onionAfter = Math.max(0, Math.min(5, Math.round(onion.after) || 0));
    sp.onionOpacity = Math.max(0.05, Math.min(1, Number(onion.opacity) || 0.35));
    sp.onionTint = onion.tint !== false;
  }

  on('paper', () => write(PAPER_KEY, { mode: sp.paperMode, color: hex(sp.paperColor) }));
  on('view', () => write(ONION_KEY, { before: sp.onionBefore, after: sp.onionAfter, opacity: sp.onionOpacity, tint: sp.onionTint }));
  on('view', () => write(GRID_KEY, { w: sp.gridW, h: sp.gridH, show: sp.showGrid }));
}
