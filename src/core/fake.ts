// Fake pixel art like image generators make it: a small pixel map blown up with
// uneven cells, per-cell color jitter, per-pixel noise and a blur. Used for the
// page's sample and for the tests.

import type { RGB } from './color';
import type { SourceImage } from './grid';

export type Rng = () => number;

// Small deterministic generator (mulberry32) so tests get the same images every run.
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PixelMap {
  rows: string[];
  palette: Record<string, RGB>;
}

export const LANTERN = { width: 66, height: 20, frames: 4, frameWidth: 10, frameHeight: 14, colors: 7 };

// A 4-frame spritesheet of a lantern whose flame flickers, on a light background.
export function lanternSheet(): PixelMap {
  const frame = [
    '....1111....',
    '...122221...',
    '....1111....',
    '...133331...',
    '..13444431..',
    '.13######31.',
    '.13######31.',
    '.13######31.',
    '.13######31.',
    '.13######31.',
    '..13333331..',
    '...111111...',
    '....1221....',
    '...122221...',
  ];
  const flames = [
    ['444444', '445544', '455654', '456654', '445544'],
    ['445444', '455544', '456654', '456654', '445544'],
    ['444544', '445554', '456654', '455654', '445544'],
    ['444444', '444544', '455654', '456654', '444444'],
  ];
  const fw = 12, gap = 4, pad = 3;
  const W = pad * 2 + flames.length * fw + (flames.length - 1) * gap, H = frame.length + pad * 2;
  const map = Array.from({ length: H }, () => Array<string>(W).fill('.'));
  flames.forEach((flame, f) => {
    let row = 0;
    frame.forEach((line, y) => {
      const l = line.includes('#') ? line.replace('######', flame[row++]) : line;
      for (let x = 0; x < fw; x++) map[pad + y][pad + f * (fw + gap) + x] = l[x];
    });
  });
  return {
    rows: map.map((r) => r.join('')),
    palette: { '.': [222, 226, 232], 1: [27, 21, 48], 2: [90, 84, 112], 3: [194, 124, 58], 4: [242, 196, 90], 5: [255, 233, 160], 6: [255, 248, 224] },
  };
}

export interface FakeOptions {
  minCell?: number;
  spread?: number;
  jitter?: number;
  noise?: number;
  blur?: number;
}

export function fakePixelArt(map: PixelMap, rng: Rng = Math.random, o: FakeOptions = {}): SourceImage {
  const { minCell = 14, spread = 4, jitter = 12, noise = 10, blur = 1 } = o;
  const H = map.rows.length, W = map.rows[0].length;
  const edges = (n: number) => { const e = [0]; for (let i = 0; i < n; i++) e.push(e[i] + minCell + Math.floor(rng() * spread)); return e; };
  const ex = edges(W), ey = edges(H);
  const w = ex[W], h = ey[H];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const base = map.palette[map.rows[cy][cx]];
      const c = base.map((v) => v + (rng() - 0.5) * jitter);
      for (let y = ey[cy]; y < ey[cy + 1]; y++) {
        for (let x = ex[cx]; x < ex[cx + 1]; x++) {
          const d = (rng() - 0.5) * noise;
          const i = (y * w + x) * 4;
          data[i] = c[0] + d; data[i + 1] = c[1] + d; data[i + 2] = c[2] + d; data[i + 3] = 255;
        }
      }
    }
  }
  if (blur > 0) gaussianBlur(data, w, h, blur);
  return { data, w, h };
}

// Separable gaussian blur of the color channels (like CSS blur(), sigma in px).
function gaussianBlur(data: Uint8ClampedArray, w: number, h: number, sigma: number): void {
  const r = Math.ceil(sigma * 3);
  const k: number[] = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  const kernel = k.map((v) => v / sum);
  const tmp = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += data[(y * w + Math.min(w - 1, Math.max(0, x + j))) * 4 + c] * kernel[j + r];
      tmp[(y * w + x) * 3 + c] = s;
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += tmp[(Math.min(h - 1, Math.max(0, y + j)) * w + x) * 3 + c] * kernel[j + r];
      data[(y * w + x) * 4 + c] = s;
    }
  }
}
