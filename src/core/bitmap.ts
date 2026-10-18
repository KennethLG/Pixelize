// Pixel operations for the sprite editor: brushes, lines, rectangles, flood
// fill, selection masks and floating pieces. Bitmaps are RGBA bytes, row by row.
// A mask is one byte per pixel (1 = selected) over the same width and height.

import type { RGBA } from './color';

export interface Bitmap { w: number; h: number; px: Uint8ClampedArray }
export type Mask = Uint8Array;
export interface Box { x: number; y: number; w: number; h: number }

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

export const newBitmap = (w: number, h: number): Bitmap => ({ w, h, px: new Uint8ClampedArray(w * h * 4) });
export const cloneBitmap = (b: Bitmap): Bitmap => ({ w: b.w, h: b.h, px: b.px.slice() });

export function getPixel(b: Bitmap, x: number, y: number): RGBA {
  const i = (y * b.w + x) * 4;
  return [b.px[i], b.px[i + 1], b.px[i + 2], b.px[i + 3]];
}

const sameAt = (px: Uint8ClampedArray, i: number, c: RGBA) =>
  px[i + 3] === 0 && c[3] === 0 ? true : px[i] === c[0] && px[i + 1] === c[1] && px[i + 2] === c[2] && px[i + 3] === c[3];

/**
 * How strokes and shapes are painted: limited to a selection mask, mirrored
 * across the canvas center (symX: left/right, symY: top/bottom), and wrapped
 * around the edges (tile mode). A bare mask still works where options go.
 */
export interface PaintOpts { mask?: Mask | null; symX?: boolean; symY?: boolean; wrap?: boolean }
export type Paint = PaintOpts | Mask | null | undefined;
const asOpts = (p: Paint): PaintOpts => (p instanceof Uint8Array ? { mask: p } : p ?? {});
const mod = (v: number, n: number) => ((v % n) + n) % n;

/** The bitmap positions a plot at x, y lands on (wrapped, then with its mirrors). */
export function paintPoints(w: number, h: number, x: number, y: number, p?: Paint): [number, number][] {
  const o = asOpts(p);
  if (o.wrap) { x = mod(x, w); y = mod(y, h); }
  const out: [number, number][] = [[x, y]];
  if (o.symX) out.push([w - 1 - x, y]);
  if (o.symY) out.push([x, h - 1 - y]);
  if (o.symX && o.symY) out.push([w - 1 - x, h - 1 - y]);
  return out;
}

/** Sets one pixel (and its mirrors), skipping anything outside the bitmap or outside the mask. */
export function plot(b: Bitmap, x: number, y: number, c: RGBA, p?: Paint): void {
  const o = asOpts(p);
  for (const [px, py] of paintPoints(b.w, b.h, x, y, o)) {
    if (px < 0 || py < 0 || px >= b.w || py >= b.h) continue;
    const i = py * b.w + px;
    if (o.mask && !o.mask[i]) continue;
    b.px[i * 4] = c[0]; b.px[i * 4 + 1] = c[1]; b.px[i * 4 + 2] = c[2]; b.px[i * 4 + 3] = c[3];
  }
}

/** Square brush of `size` pixels whose center (or the pixel left/up of it for even sizes) is x, y. */
export function stamp(b: Bitmap, x: number, y: number, size: number, c: RGBA, p?: Paint): void {
  const o = asOpts(p);
  const off = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) plot(b, x - off + dx, y - off + dy, c, o);
}

/** Every pixel of a Bresenham line, ends included. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

export function drawLine(b: Bitmap, x0: number, y0: number, x1: number, y1: number, size: number, c: RGBA, p?: Paint): void {
  const o = asOpts(p);
  for (const [x, y] of linePoints(x0, y0, x1, y1)) stamp(b, x, y, size, c, o);
}

/** Moves the end of a line so it is horizontal, vertical or at 45° (whichever is closest). */
export function snapAngle(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0, dy = y1 - y0, ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > 2 * ay) return [x1, y0];
  if (ay > 2 * ax) return [x0, y1];
  const d = Math.max(ax, ay);
  return [x0 + Math.sign(dx || 1) * d, y0 + Math.sign(dy || 1) * d];
}

/** True when b is the corner of an L between a and c (a and c touch diagonally, b touches both straight). */
export function isLCorner(a: [number, number], b: [number, number], c: [number, number]): boolean {
  const straight = (p: [number, number], q: [number, number]) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) === 1;
  return straight(a, b) && straight(b, c) && Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1;
}

/** A freehand path without its L-shaped corners ("pixel perfect" strokes). Repeated points are dropped too. */
export function pixelPerfect(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    if (out.length >= 2 && isLCorner(out[out.length - 2], last, p)) out.pop();
    out.push(p);
  }
  return out;
}

/** The box two corner pixels span, both included. */
export function boxOf(x0: number, y0: number, x1: number, y1: number): Box {
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

/** A filled rectangle, or its outline `size` pixels thick (drawn inward). */
export function drawRect(b: Bitmap, r: Box, filled: boolean, size: number, c: RGBA, p?: Paint): void {
  const o = asOpts(p);
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const edge = x - r.x < size || r.x + r.w - 1 - x < size || y - r.y < size || r.y + r.h - 1 - y < size;
      if (filled || edge) plot(b, x, y, c, o);
    }
  }
}

/** Pixels whose centers fall inside the ellipse that fits box `r`. */
function ellipseInside(r: Box): Uint8Array {
  const m = new Uint8Array(r.w * r.h);
  const rx = r.w / 2, ry = r.h / 2;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const dx = (x + 0.5 - rx) / rx, dy = (y + 0.5 - ry) / ry;
      if (dx * dx + dy * dy <= 1 + 1e-9) m[y * r.w + x] = 1;
    }
  }
  return m;
}

/** An ellipse (a circle in a square box), filled or as an outline `size` pixels thick. */
export function drawEllipse(b: Bitmap, r: Box, filled: boolean, size: number, c: RGBA, p?: Paint): void {
  const o = asOpts(p);
  let shape = ellipseInside(r);
  if (!filled) {
    // the outline is what an erosion of `size` steps takes away
    let inner = shape;
    for (let k = 0; k < size; k++) {
      const next = new Uint8Array(inner.length);
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const i = y * r.w + x;
          next[i] = inner[i] && x > 0 && y > 0 && x < r.w - 1 && y < r.h - 1
            && inner[i - 1] && inner[i + 1] && inner[i - r.w] && inner[i + r.w] ? 1 : 0;
        }
      }
      inner = next;
    }
    shape = shape.map((v, i) => (v && !inner[i] ? 1 : 0));
  }
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (shape[y * r.w + x]) plot(b, r.x + x, r.y + y, c, o);
}

/**
 * Paints the transparent pixels that touch the art (the opaque pixels, only the
 * selected ones with a mask) in color c: a 1 px outline around it. With
 * `corners` diagonal neighbours count too. Returns how many pixels changed.
 */
export function outline(b: Bitmap, c: RGBA, corners: boolean, mask?: Mask | null): number {
  const { w, h, px } = b;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] > 0 && (!mask || mask[y * w + x] === 1);
  const near = corners
    ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    : [[0, -1], [-1, 0], [1, 0], [0, 1]];
  const targets: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 0) continue;
      if (near.some(([dx, dy]) => solid(x + dx, y + dy))) targets.push(y * w + x);
    }
  }
  for (const p of targets) { px[p * 4] = c[0]; px[p * 4 + 1] = c[1]; px[p * 4 + 2] = c[2]; px[p * 4 + 3] = c[3]; }
  return targets.length;
}

/** Repaints every pixel of color `from` (in the mask, if any). Returns how many changed. */
export function replaceColor(b: Bitmap, from: RGBA, to: RGBA, mask?: Mask | null): number {
  if (sameAt(Uint8ClampedArray.from(to), 0, from)) return 0;
  let n = 0;
  for (let p = 0; p < b.w * b.h; p++) {
    if ((mask && !mask[p]) || !sameAt(b.px, p * 4, from)) continue;
    b.px[p * 4] = to[0]; b.px[p * 4 + 1] = to[1]; b.px[p * 4 + 2] = to[2]; b.px[p * 4 + 3] = to[3];
    n++;
  }
  return n;
}

/**
 * Mask of the pixels with the same color as (x, y): only the connected area
 * (4-way) when `contiguous`, otherwise every pixel of that color.
 */
export function colorMask(b: Bitmap, x: number, y: number, contiguous: boolean): Mask {
  const m = new Uint8Array(b.w * b.h);
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return m;
  const target = getPixel(b, x, y);
  if (!contiguous) {
    for (let p = 0; p < m.length; p++) if (sameAt(b.px, p * 4, target)) m[p] = 1;
    return m;
  }
  const stack = [y * b.w + x];
  m[stack[0]] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const px = p % b.w, py = (p - px) / b.w;
    const visit = (q: number) => { if (!m[q] && sameAt(b.px, q * 4, target)) { m[q] = 1; stack.push(q); } };
    if (px > 0) visit(p - 1);
    if (px < b.w - 1) visit(p + 1);
    if (py > 0) visit(p - b.w);
    if (py < b.h - 1) visit(p + b.w);
  }
  return m;
}

/** Paint bucket. Returns false when there was nothing to change. */
export function fill(b: Bitmap, x: number, y: number, c: RGBA, contiguous: boolean, mask?: Mask | null): boolean {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return false;
  if (mask && !mask[y * b.w + x]) return false;
  if (sameAt(b.px, (y * b.w + x) * 4, c)) return false;
  const area = colorMask(b, x, y, contiguous);
  for (let p = 0; p < area.length; p++) if (area[p] && (!mask || mask[p])) plot(b, p % b.w, Math.floor(p / b.w), c);
  return true;
}

// ---------- masks ----------

export function rectMask(w: number, h: number, r: Box): Mask {
  const m = new Uint8Array(w * h);
  for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) m[y * w + x] = 1;
  }
  return m;
}

export type MaskOp = 'replace' | 'add' | 'subtract';

export function combineMasks(a: Mask | null, b: Mask, op: MaskOp): Mask {
  if (op === 'replace' || !a) return op === 'subtract' ? new Uint8Array(b.length) : b;
  const out = a.slice();
  for (let i = 0; i < b.length; i++) if (b[i]) out[i] = op === 'add' ? 1 : 0;
  return out;
}

/** Smallest box around the selected pixels, or null for an empty mask. */
export function maskBounds(m: Mask, w: number): Box | null {
  const h = m.length / w;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------- floating pieces (cut, copy, paste, move, scale) ----------

/**
 * A piece of pixels lifted off a layer, placed at x, y and drawn w × h, then
 * turned by `angle` degrees (clockwise) around `pivot`, given as a fraction of
 * the drawn box (0.5, 0.5 is its center). placeFloating() in rotsprite.ts puts it together.
 */
export interface Floating { src: Bitmap; x: number; y: number; w: number; h: number; angle?: number; pivot?: [number, number] }

/** Copies the masked pixels (all of them without a mask) into a bitmap the size of their bounds. */
export function extract(b: Bitmap, mask: Mask | null): { piece: Bitmap; box: Box } | null {
  const box = mask ? maskBounds(mask, b.w) : { x: 0, y: 0, w: b.w, h: b.h };
  if (!box) return null;
  const piece = newBitmap(box.w, box.h);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const p = (box.y + y) * b.w + box.x + x;
      if (mask && !mask[p]) continue;
      piece.px.set(b.px.subarray(p * 4, p * 4 + 4), (y * box.w + x) * 4);
    }
  }
  return { piece, box };
}

export function clearMasked(b: Bitmap, mask: Mask | null): void {
  if (!mask) { b.px.fill(0); return; }
  for (let p = 0; p < mask.length; p++) if (mask[p]) b.px.fill(0, p * 4, p * 4 + 4);
}

/** Nearest-neighbor resize, so pixel art stays crisp. Negative sizes flip. */
export function scaleNearest(src: Bitmap, w: number, h: number): Bitmap {
  const W = Math.max(1, Math.abs(w)), H = Math.max(1, Math.abs(h));
  const out = newBitmap(W, H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(src.h - 1, Math.floor(((h < 0 ? H - 1 - y : y) + 0.5) * src.h / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(src.w - 1, Math.floor(((w < 0 ? W - 1 - x : x) + 0.5) * src.w / W));
      out.px.set(src.px.subarray((sy * src.w + sx) * 4, (sy * src.w + sx) * 4 + 4), (y * W + x) * 4);
    }
  }
  return out;
}

/** Turns a bitmap a quarter turn, clockwise or not. Width and height swap. */
export function rotate90(src: Bitmap, clockwise: boolean): Bitmap {
  const out = newBitmap(src.h, src.w);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const X = clockwise ? src.h - 1 - y : y, Y = clockwise ? x : src.w - 1 - x;
      out.px.set(src.px.subarray((y * src.w + x) * 4, (y * src.w + x) * 4 + 4), (Y * out.w + X) * 4);
    }
  }
  return out;
}

export function flip(src: Bitmap, horizontal: boolean): Bitmap {
  return scaleNearest(src, horizontal ? -src.w : src.w, horizontal ? src.h : -src.h);
}

/** The floating piece at its drawn size. */
export const renderFloating = (f: Floating): Bitmap =>
  f.w === f.src.w && f.h === f.src.h ? f.src : scaleNearest(f.src, f.w, f.h);

/** Pastes `piece` with its top-left at x, y. Transparent pixels leave the layer as it was. */
export function blit(dst: Bitmap, piece: Bitmap, x: number, y: number): void {
  for (let py = 0; py < piece.h; py++) {
    const dy = y + py;
    if (dy < 0 || dy >= dst.h) continue;
    for (let px = 0; px < piece.w; px++) {
      const dx = x + px;
      if (dx < 0 || dx >= dst.w) continue;
      const s = (py * piece.w + px) * 4;
      if (piece.px[s + 3] === 0) continue;
      dst.px.set(piece.px.subarray(s, s + 4), (dy * dst.w + dx) * 4);
    }
  }
}

/**
 * Mask of a freehand outline (lasso): the pixels whose centers are inside the
 * polygon (even-odd), plus the pixels the outline passes through. Points are
 * in pixels, 0, 0 being the top-left corner of the canvas.
 */
export function polygonMask(w: number, h: number, pts: [number, number][]): Mask {
  const m = new Uint8Array(w * h);
  const n = pts.length;
  for (let y = 0; y < h && n >= 3; y++) {
    const yc = y + 0.5, xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
      if ((ay <= yc) !== (by <= yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5)), to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) m[y * w + x] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    for (const [x, y] of linePoints(Math.floor(ax), Math.floor(ay), Math.floor(bx), Math.floor(by))) {
      if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1;
    }
  }
  return m;
}

/** Mask of the pixels a placed piece (placeFloating) covers once it is put down. */
export function floatingMask(w: number, h: number, placed: { piece: Bitmap; x: number; y: number }): Mask {
  const { piece } = placed;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < piece.h; y++) {
    for (let x = 0; x < piece.w; x++) {
      const X = placed.x + x, Y = placed.y + y;
      if (X >= 0 && Y >= 0 && X < w && Y < h && piece.px[(y * piece.w + x) * 4 + 3]) m[Y * w + X] = 1;
    }
  }
  return m;
}
