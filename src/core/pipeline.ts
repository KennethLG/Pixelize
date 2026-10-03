// The whole conversion: grid → one color per cell → palette → color edits →
// cleanup → background → crop. Pure, so the page, its worker, the CLI and the
// tests all run exactly this.

import { dist2, keyAt, labOf, labOfKey, type RGB } from './color';
import { analyzeGrid, type Grid, type GridCache, type GridSettings, type SourceImage } from './grid';
import { sampleCells } from './cells';
import { applyColorMaps, applyPalette, autoPalette, collectColors, kmeansPalette, pinnedEntries, type ColorMap, type PaletteEntry } from './palette';
import { cleanStray } from './cleanup';
import { borderColor, removeBackground, type BgMode } from './background';
import { cropPixels, cropRect, type CropSettings } from './crop';
import type { Rect } from './frames';

export type PaletteMode = 'auto' | 'fixed' | 'imported';

export interface BgPick {
  key: number;
  x: number;
  y: number;
}

export interface ProcessOptions {
  size: GridSettings;
  alpha: number;
  palette: {
    mode: PaletteMode;
    tol: number;
    count: number;
    imported: RGB[];
    locks: RGB[];
    maps: ColorMap[];
  };
  clean: { on: boolean; strength: number };
  bg: { on: boolean; mode: BgMode; tol: number; pick: BgPick | null };
  crop: CropSettings;
}

export interface ProcessResult {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  /** The pixels before background removal and crop (for picking a background color), fullW × fullH. */
  preBg: Uint8ClampedArray;
  fullW: number;
  fullH: number;
  /** The part of the fullW × fullH image kept in `pixels`. */
  crop: Rect;
  bgKey: number | null;
  /** The background color plus every color within the background tolerance. */
  bgKeys: number[];
  bgAuto: boolean;
  sampled: number;
  grid: Grid;
}

export function defaultOptions(): ProcessOptions {
  return {
    size: { mode: 'auto', cellX: 16, cellY: 16, offX: 0, offY: 0, snap: true, fw: 64, fh: 64 },
    alpha: 128,
    palette: { mode: 'auto', tol: 10, count: 16, imported: [], locks: [], maps: [] },
    clean: { on: false, strength: 15 },
    bg: { on: false, mode: 'edge', tol: 6, pick: null },
    crop: { mode: 'off', pad: 0, left: 0, top: 0, right: 0, bottom: 0 },
  };
}

export function processImage(src: SourceImage, cache: GridCache, o: ProcessOptions): ProcessResult {
  const grid = analyzeGrid(src, cache, o.size);
  const small = sampleCells(src.data, src.w, grid.xs, grid.ys, o.alpha);
  const { width: w, height: h } = small;
  const colors = collectColors(small.pixels);
  const P = o.palette;
  const locks = pinnedEntries(P.locks);
  let palette: PaletteEntry[];
  if (P.mode === 'imported') {
    if (!P.imported.length) throw new Error('Load a palette first, or pick another color mode.');
    palette = P.imported.map((rgb) => ({ rgb, lab: labOf(rgb) }));
  } else if (!colors.length) palette = locks;
  else if (P.mode === 'fixed') palette = kmeansPalette(colors, Math.max(2, P.count || 16), locks);
  else palette = autoPalette(colors, P.tol, locks);

  let px = small.pixels;
  if (palette.length) applyPalette(px, palette);
  if (P.mode !== 'imported') applyColorMaps(px, P.maps);
  if (o.clean.on) px = cleanStray(px, w, h, o.clean.strength);
  const preBg = new Uint8ClampedArray(px);

  const present = new Set<number>();
  for (let i = 0; i < px.length; i += 4) if (px[i + 3]) present.add(keyAt(px, i));
  const pick = o.bg.pick && present.has(o.bg.pick.key) ? o.bg.pick : null;
  const bgKey = pick ? pick.key : borderColor(px, w, h);
  const bgKeys: number[] = [];
  if (bgKey !== null) {
    const lab = labOfKey(bgKey), t2 = o.bg.tol * o.bg.tol;
    for (const k of present) if (k === bgKey || dist2(labOfKey(k), lab) <= t2) bgKeys.push(k);
  }
  if (o.bg.on && bgKey !== null) removeBackground(px, w, h, new Set(bgKeys), o.bg.mode, pick);

  // background colors count as empty space even when they were not removed
  const crop = cropRect(px, w, h, new Set(bgKeys), o.crop);
  if (crop.w !== w || crop.h !== h) px = cropPixels(px, w, crop);

  return { width: crop.w, height: crop.h, pixels: px, preBg, fullW: w, fullH: h, crop, bgKey, bgKeys, bgAuto: !pick, sampled: colors.length, grid };
}
