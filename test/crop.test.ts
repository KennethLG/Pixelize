import { describe, expect, it } from 'vitest';
import { contentBox, cropPixels, cropRect, type CropSettings } from '../src/core/crop';
import { fakePixelArt, lanternSheet, makeRng } from '../src/core/fake';
import { run } from './helpers';

// 6×5 transparent image with an opaque 2×2 block at (2,1) and one pixel of
// "background" color 0x112233 at (5,4).
function sample() {
  const w = 6, h = 5, px = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => px.set([r, g, b, 255], (y * w + x) * 4);
  for (const [x, y] of [[2, 1], [3, 1], [2, 2], [3, 2]]) set(x, y, 200, 10, 10);
  set(5, 4, 0x11, 0x22, 0x33);
  return { px, w, h };
}

const opts = (patch: Partial<CropSettings>): CropSettings => ({ mode: 'trim', pad: 0, left: 0, top: 0, right: 0, bottom: 0, ...patch });

describe('crop', () => {
  it('finds the content box, ignoring background colors', () => {
    const { px, w, h } = sample();
    expect(contentBox(px, w, h, new Set())).toEqual({ x: 2, y: 1, w: 4, h: 4 });
    expect(contentBox(px, w, h, new Set([0x112233]))).toEqual({ x: 2, y: 1, w: 2, h: 2 });
  });

  it('trims with padding, clamped to the image', () => {
    const { px, w, h } = sample();
    const bg = new Set([0x112233]);
    expect(cropRect(px, w, h, bg, opts({}))).toEqual({ x: 2, y: 1, w: 2, h: 2 });
    expect(cropRect(px, w, h, bg, opts({ pad: 1 }))).toEqual({ x: 1, y: 0, w: 4, h: 4 });
    expect(cropRect(px, w, h, bg, opts({ pad: 9 }))).toEqual({ x: 0, y: 0, w: 6, h: 5 });
  });

  it('cuts manual margins and never goes empty', () => {
    const { px, w, h } = sample();
    expect(cropRect(px, w, h, new Set(), opts({ mode: 'manual', left: 1, top: 2, right: 2, bottom: 1 }))).toEqual({ x: 1, y: 2, w: 3, h: 2 });
    const r = cropRect(px, w, h, new Set(), opts({ mode: 'manual', left: 50, right: 50, top: 50, bottom: 50 }));
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });

  it('copies the kept pixels', () => {
    const { px, w } = sample();
    const out = cropPixels(px, w, { x: 2, y: 1, w: 2, h: 2 });
    expect(out.length).toBe(16);
    for (let i = 0; i < 16; i += 4) expect([...out.subarray(i, i + 4)]).toEqual([200, 10, 10, 255]);
  });

  it('runs at the end of the pipeline', () => {
    const src = fakePixelArt(lanternSheet(), makeRng(3));
    const full = run(src, (o) => { o.bg.on = true; });
    const trimmed = run(src, (o) => { o.bg.on = true; o.crop = opts({}); });
    expect(trimmed.width).toBeLessThanOrEqual(full.width);
    expect(trimmed.height).toBeLessThan(full.height);
    expect([trimmed.fullW, trimmed.fullH]).toEqual([full.width, full.height]);
    // the trimmed result is exactly that window of the full one
    const { x, y, w, h } = trimmed.crop;
    expect([w, h]).toEqual([trimmed.width, trimmed.height]);
    expect([...trimmed.pixels]).toEqual([...cropPixels(full.pixels, full.width, { x, y, w, h })]);
  });
});
