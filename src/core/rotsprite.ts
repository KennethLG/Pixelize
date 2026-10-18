// RotSprite: turns pixel art by any angle without the jagged, broken lines of a
// plain nearest-neighbor rotation. The art is first scaled up 8× with Scale2x
// (which rounds diagonals instead of making blocks), then every output pixel
// takes the color at its center, turned back into that big image. No new
// colors are made.

import { newBitmap, scaleNearest, type Bitmap, type Floating } from './bitmap';

/** Scale2x (EPX): doubles the size, smoothing diagonal edges. Fully transparent pixels count as one color. */
export function scale2x(src: Bitmap): Bitmap {
  const { w, h } = src;
  const inp = new Uint32Array(w * h);
  const px = src.px.byteOffset % 4 ? src.px.slice() : src.px;
  const view = new Uint32Array(px.buffer, px.byteOffset, w * h);
  for (let i = 0; i < inp.length; i++) inp[i] = src.px[i * 4 + 3] ? view[i] : 0;
  const W = w * 2;
  const out = new Uint32Array(W * h * 2);
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w, row = y * w, down = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - 1), r = Math.min(w - 1, x + 1);
      const B = inp[up + x], D = inp[row + l], E = inp[row + x], F = inp[row + r], H = inp[down + x];
      let e0 = E, e1 = E, e2 = E, e3 = E;
      if (B !== H && D !== F) {
        if (D === B) e0 = D;
        if (B === F) e1 = F;
        if (D === H) e2 = D;
        if (H === F) e3 = F;
      }
      const o = y * 2 * W + x * 2;
      out[o] = e0; out[o + 1] = e1; out[o + W] = e2; out[o + W + 1] = e3;
    }
  }
  return { w: W, h: h * 2, px: new Uint8ClampedArray(out.buffer) };
}

const upscaled = new WeakMap<Bitmap, Bitmap>();
function up8(src: Bitmap): Bitmap {
  let u = upscaled.get(src);
  if (!u) { u = scale2x(scale2x(scale2x(src))); upscaled.set(src, u); }
  return u;
}

/** cos/sin with exact values on the quarter turns, so 90° turns stay exact. */
function cosSin(deg: number): [number, number] {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return [1, 0];
  if (d === 90) return [0, 1];
  if (d === 180) return [-1, 0];
  if (d === 270) return [0, -1];
  const t = (d * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t)];
}

/**
 * Turns `src` by `deg` degrees (clockwise on screen) around the point cx, cy
 * (in src pixels; 0, 0 is its top-left corner). Returns the turned art and
 * where its top-left lands, relative to src's top-left.
 */
export function rotsprite(src: Bitmap, deg: number, cx: number, cy: number): { piece: Bitmap; x: number; y: number } {
  const [cos, sin] = cosSin(deg);
  if (cos === 1) return { piece: { w: src.w, h: src.h, px: src.px.slice() }, x: 0, y: 0 };
  const turn = (x: number, y: number): [number, number] => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
  const corners = [turn(0, 0), turn(src.w, 0), turn(0, src.h), turn(src.w, src.h)];
  const eps = 1e-6;
  const x0 = Math.floor(Math.min(...corners.map((c) => c[0])) + eps), x1 = Math.ceil(Math.max(...corners.map((c) => c[0])) - eps);
  const y0 = Math.floor(Math.min(...corners.map((c) => c[1])) + eps), y1 = Math.ceil(Math.max(...corners.map((c) => c[1])) - eps);
  const piece = newBitmap(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  const big = up8(src), K = 8;
  for (let Y = 0; Y < piece.h; Y++) {
    for (let X = 0; X < piece.w; X++) {
      // the center of the output pixel, turned back into src
      const dx = x0 + X + 0.5 - cx, dy = y0 + Y + 0.5 - cy;
      const u = cx + dx * cos + dy * sin, v = cy - dx * sin + dy * cos;
      if (u < 0 || v < 0 || u >= src.w || v >= src.h) continue;
      const bi = (Math.floor(v * K) * big.w + Math.floor(u * K)) * 4;
      if (!big.px[bi + 3]) continue;
      piece.px.set(big.px.subarray(bi, bi + 4), (Y * piece.w + X) * 4);
    }
  }
  return { piece, x: x0, y: y0 };
}

/** Where a floating piece lands: its art at the drawn size, turned around its pivot, and its top-left corner. */
export interface Placed { piece: Bitmap; x: number; y: number }

let lastKey = '', lastSrc: Bitmap | null = null, lastPlaced: Placed | null = null;
let scaledKey = '', scaledSrc: Bitmap | null = null, scaled: Bitmap | null = null;

/** The floating piece as it will be put down (drawn size, then the turn). Cached, since the canvas asks on every redraw. */
export function placeFloating(f: Floating): Placed {
  let art = f.src;
  if (f.w !== f.src.w || f.h !== f.src.h) {
    const k = `${f.w}x${f.h}`;
    if (scaledSrc !== f.src || scaledKey !== k) { scaled = scaleNearest(f.src, f.w, f.h); scaledSrc = f.src; scaledKey = k; }
    art = scaled!;
  }
  if (!f.angle) return { piece: art, x: f.x, y: f.y };
  const [px, py] = f.pivot ?? [0.5, 0.5];
  const key = `${f.w}x${f.h}@${f.angle}/${px},${py}`;
  if (lastSrc !== f.src || lastKey !== key) {
    lastPlaced = rotsprite(art, f.angle, px * f.w, py * f.h);
    lastSrc = f.src;
    lastKey = key;
  }
  return { piece: lastPlaced!.piece, x: f.x + lastPlaced!.x, y: f.y + lastPlaced!.y };
}
