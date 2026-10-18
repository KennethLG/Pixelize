// The sprite document: a canvas size, layers (bottom first) and frames. Each
// frame holds one cel (a bitmap) per layer, in the same order as `layers`.

import { newBitmap, type Bitmap } from './bitmap';

export interface Layer { name: string; visible: boolean; opacity: number }
export interface Frame { cels: Bitmap[]; duration: number }
export interface SpriteDoc { w: number; h: number; layers: Layer[]; frames: Frame[] }

export const DEFAULT_DURATION = 100; // ms

export function createDoc(w: number, h: number): SpriteDoc {
  return { w, h, layers: [{ name: 'Layer 1', visible: true, opacity: 1 }], frames: [{ cels: [newBitmap(w, h)], duration: DEFAULT_DURATION }] };
}

export const cloneDoc = (d: SpriteDoc): SpriteDoc => ({
  w: d.w, h: d.h,
  layers: d.layers.map((l) => ({ ...l })),
  frames: d.frames.map((f) => ({ duration: f.duration, cels: f.cels.map((c) => ({ w: c.w, h: c.h, px: c.px.slice() })) })),
});

const move = <T>(arr: T[], from: number, to: number) => { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); };

/** A name like "Layer 3" that no layer uses yet. */
export function nextLayerName(d: SpriteDoc): string {
  let n = d.layers.length + 1;
  while (d.layers.some((l) => l.name === `Layer ${n}`)) n++;
  return `Layer ${n}`;
}

// ---------- layers ----------

export function addLayer(d: SpriteDoc, at: number, name = nextLayerName(d)): void {
  d.layers.splice(at, 0, { name, visible: true, opacity: 1 });
  for (const f of d.frames) f.cels.splice(at, 0, newBitmap(d.w, d.h));
}

export function duplicateLayer(d: SpriteDoc, i: number): void {
  d.layers.splice(i + 1, 0, { ...d.layers[i], name: `${d.layers[i].name} copy` });
  for (const f of d.frames) f.cels.splice(i + 1, 0, { w: d.w, h: d.h, px: f.cels[i].px.slice() });
}

export function removeLayer(d: SpriteDoc, i: number): boolean {
  if (d.layers.length < 2) return false;
  d.layers.splice(i, 1);
  for (const f of d.frames) f.cels.splice(i, 1);
  return true;
}

export function moveLayer(d: SpriteDoc, from: number, to: number): void {
  if (from === to) return;
  move(d.layers, from, to);
  for (const f of d.frames) move(f.cels, from, to);
}

/** Draws layer i onto the layer below it (in every frame) and removes it. */
export function mergeDown(d: SpriteDoc, i: number): boolean {
  if (i < 1) return false;
  const top = d.layers[i];
  for (const f of d.frames) {
    const below = f.cels[i - 1];
    if (top.visible) blendOver(below.px, f.cels[i].px, top.opacity);
  }
  removeLayer(d, i);
  return true;
}

// ---------- frames ----------

export function addFrame(d: SpriteDoc, at: number): void {
  d.frames.splice(at, 0, { cels: d.layers.map(() => newBitmap(d.w, d.h)), duration: d.frames[Math.max(0, at - 1)]?.duration ?? DEFAULT_DURATION });
}

export function duplicateFrame(d: SpriteDoc, i: number): void {
  const f = d.frames[i];
  d.frames.splice(i + 1, 0, { duration: f.duration, cels: f.cels.map((c) => ({ w: c.w, h: c.h, px: c.px.slice() })) });
}

export function removeFrame(d: SpriteDoc, i: number): boolean {
  if (d.frames.length < 2) return false;
  d.frames.splice(i, 1);
  return true;
}

export const moveFrame = (d: SpriteDoc, from: number, to: number) => { if (from !== to) move(d.frames, from, to); };

// ---------- canvas size ----------

/** Changes the canvas size. ax/ay (0, 0.5 or 1) say which side stays put: 0.5 keeps the art centered. */
export function resizeCanvas(d: SpriteDoc, w: number, h: number, ax = 0.5, ay = 0.5): void {
  const dx = Math.round((w - d.w) * ax), dy = Math.round((h - d.h) * ay);
  for (const f of d.frames) {
    f.cels = f.cels.map((c) => {
      const out = newBitmap(w, h);
      for (let y = 0; y < c.h; y++) {
        const Y = y + dy;
        if (Y < 0 || Y >= h) continue;
        for (let x = 0; x < c.w; x++) {
          const X = x + dx;
          if (X >= 0 && X < w) out.px.set(c.px.subarray((y * c.w + x) * 4, (y * c.w + x) * 4 + 4), (Y * w + X) * 4);
        }
      }
      return out;
    });
  }
  d.w = w;
  d.h = h;
}

// ---------- compositing ----------

/** Source-over blend of `src` onto `dst` (same size), with an extra opacity. */
export function blendOver(dst: Uint8ClampedArray, src: Uint8ClampedArray, opacity = 1): void {
  for (let i = 0; i < src.length; i += 4) {
    const sa = (src[i + 3] / 255) * opacity;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) dst[i + k] = (src[i + k] * sa + dst[i + k] * da * (1 - sa)) / oa;
    dst[i + 3] = oa * 255;
  }
}

/**
 * The visible image of frame `fi`. `override` swaps one layer's cel for
 * another bitmap (the editor uses it to show a selection being moved).
 */
export function composite(d: SpriteDoc, fi: number, override?: { layer: number; cel: Bitmap }): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.w * d.h * 4);
  const f = d.frames[fi];
  d.layers.forEach((l, li) => {
    if (!l.visible || l.opacity <= 0) return;
    const cel = override && override.layer === li ? override.cel : f.cels[li];
    blendOver(out, cel.px, l.opacity);
  });
  return out;
}

/** Every opaque color used anywhere in the sprite, as 0xRRGGBB keys, most used first. */
export function usedColors(d: SpriteDoc): number[] {
  const counts = new Map<number, number>();
  for (const f of d.frames) {
    for (const c of f.cels) {
      const px = c.px;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
}

// ---------- saving (autosave and project files) ----------

interface SavedDoc { v: 1; w: number; h: number; layers: Layer[]; frames: { duration: number; cels: string[] }[] }

const toB64 = (px: Uint8ClampedArray) => {
  let s = '';
  for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8ClampedArray.from(atob(s), (ch) => ch.charCodeAt(0));

export function serializeDoc(d: SpriteDoc): string {
  const saved: SavedDoc = { v: 1, w: d.w, h: d.h, layers: d.layers, frames: d.frames.map((f) => ({ duration: f.duration, cels: f.cels.map((c) => toB64(c.px)) })) };
  return JSON.stringify(saved);
}

export function parseDoc(text: string): SpriteDoc | null {
  try {
    const s = JSON.parse(text) as SavedDoc;
    if (s.v !== 1 || !(s.w > 0) || !(s.h > 0) || !s.layers?.length || !s.frames?.length) return null;
    const size = s.w * s.h * 4;
    const frames = s.frames.map((f) => ({
      duration: f.duration || DEFAULT_DURATION,
      cels: s.layers.map((_, i) => {
        const px = f.cels[i] ? fromB64(f.cels[i]) : new Uint8ClampedArray(size);
        return { w: s.w, h: s.h, px: px.length === size ? px : new Uint8ClampedArray(size) };
      }),
    }));
    return { w: s.w, h: s.h, layers: s.layers.map((l) => ({ name: String(l.name), visible: l.visible !== false, opacity: Number.isFinite(+l.opacity) ? Math.max(0, Math.min(1, +l.opacity)) : 1 })), frames };
  } catch {
    return null;
  }
}
