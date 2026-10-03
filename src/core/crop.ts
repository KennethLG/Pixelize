// Cropping the result: trimming the empty space around the art, or cutting
// fixed margins off each side.

import { keyAt } from './color';
import type { Rect } from './frames';

export type CropMode = 'off' | 'trim' | 'manual';

export interface CropSettings {
  mode: CropMode;
  /** Trim: empty pixels kept around the art on every side. */
  pad: number;
  /** Manual: pixels cut from each side. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Bounding box of the pixels that are neither transparent nor one of the
// empty (background) colors, or null when there are none.
export function contentBox(px: Uint8ClampedArray, w: number, h: number, emptyKeys: Set<number>): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] === 0 || emptyKeys.has(keyAt(px, i))) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The part of a w×h image to keep. Never empty, never outside the image. */
export function cropRect(px: Uint8ClampedArray, w: number, h: number, emptyKeys: Set<number>, s: CropSettings): Rect {
  const full = { x: 0, y: 0, w, h };
  if (s.mode === 'trim') {
    const box = contentBox(px, w, h, emptyKeys);
    if (!box) return full;
    const pad = Math.max(0, Math.floor(s.pad) || 0);
    const x0 = Math.max(0, box.x - pad), y0 = Math.max(0, box.y - pad);
    const x1 = Math.min(w, box.x + box.w + pad), y1 = Math.min(h, box.y + box.h + pad);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (s.mode === 'manual') {
    const cut = (v: number) => Math.max(0, Math.floor(v) || 0);
    const x0 = Math.min(w - 1, cut(s.left)), y0 = Math.min(h - 1, cut(s.top));
    const x1 = Math.max(x0 + 1, w - cut(s.right)), y1 = Math.max(y0 + 1, h - cut(s.bottom));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return full;
}

export function cropPixels(px: Uint8ClampedArray, w: number, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const from = ((r.y + y) * w + r.x) * 4;
    out.set(px.subarray(from, from + r.w * 4), y * r.w * 4);
  }
  return out;
}
