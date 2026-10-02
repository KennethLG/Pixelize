// Spritesheet splitting and playback order.

import { keyAt } from './color';
import { uniformCuts } from './grid';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Splits [0, n) into runs of lines with content, separated by at least minGap empty lines.
export function bands(n: number, isLineEmpty: (i: number) => boolean, minGap: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1, emptyRun = 0;
  for (let i = 0; i < n; i++) {
    if (isLineEmpty(i)) {
      if (start < 0) continue;
      emptyRun++;
      if (emptyRun >= minGap) { out.push([start, i - emptyRun + 1]); start = -1; }
    } else {
      if (start < 0) start = i;
      emptyRun = 0;
    }
  }
  if (start >= 0) out.push([start, n - emptyRun]);
  return out;
}

// Frames = blocks of content separated by background: first rows of frames,
// then the frames inside each row, each trimmed to its own content.
export function findFrames(px: Uint8ClampedArray, w: number, h: number, bgKeys: Set<number>, minGap: number): Rect[] {
  const empty = (x: number, y: number) => { const i = (y * w + x) * 4; return px[i + 3] === 0 || bgKeys.has(keyAt(px, i)); };
  const spanEmpty = (y: number, x0: number, x1: number) => { for (let x = x0; x < x1; x++) if (!empty(x, y)) return false; return true; };
  const frames: Rect[] = [];
  for (const [y0, y1] of bands(h, (y) => spanEmpty(y, 0, w), minGap)) {
    const colEmpty = (x: number) => { for (let y = y0; y < y1; y++) if (!empty(x, y)) return false; return true; };
    for (const [x0, x1] of bands(w, colEmpty, minGap)) {
      let t = y0, b = y1;
      while (t < b && spanEmpty(t, x0, x1)) t++;
      while (b > t && spanEmpty(b - 1, x0, x1)) b--;
      if (b > t) frames.push({ x: x0, y: t, w: x1 - x0, h: b - t });
    }
  }
  if (!frames.length) return frames;
  // stray specks between frames are not frames
  const maxArea = Math.max(...frames.map((f) => f.w * f.h));
  return frames.filter((f) => f.w * f.h >= maxArea * 0.1);
}

export function gridFrames(w: number, h: number, cols: number, rows: number): Rect[] {
  const xs = uniformCuts(w, cols), ys = uniformCuts(h, rows);
  const frames: Rect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    frames.push({ x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r] });
  }
  return frames;
}

export type Direction = 'forward' | 'reverse' | 'pingpong';

// Next position among n active frames, or null when a "once" run is over.
// pingDir is the ping-pong heading (1 forward, -1 back) and is returned updated.
export function nextIndex(i: number, n: number, dir: Direction, once: boolean, pingDir: number): { next: number | null; pingDir: number } {
  if (n <= 1) return { next: once ? null : 0, pingDir };
  if (dir === 'pingpong') {
    let next = i + pingDir;
    if (next >= n) { pingDir = -1; next = n - 2; }
    else if (next < 0) {
      if (once) return { next: null, pingDir };
      pingDir = 1; next = 1;
    }
    return { next, pingDir };
  }
  const next = i + (dir === 'reverse' ? -1 : 1);
  if (next >= 0 && next < n) return { next, pingDir };
  return { next: once ? null : next < 0 ? n - 1 : 0, pingDir };
}

// One full playback cycle, as the preview plays it (used to bake GIFs).
export function playbackSequence(active: number[], dir: Direction, once: boolean): number[] {
  if (dir === 'reverse') return [...active].reverse();
  if (dir === 'pingpong' && active.length > 1) {
    return once ? active.concat(active.slice(0, -1).reverse()) : active.concat(active.slice(1, -1).reverse());
  }
  return active;
}
