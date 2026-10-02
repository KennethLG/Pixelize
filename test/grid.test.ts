import { describe, expect, it } from 'vitest';
import { fakePixelArt, lanternSheet, LANTERN, makeRng } from '../src/core/fake';
import { confidenceLevel } from '../src/core/grid';
import { findFrames } from '../src/core/frames';
import { regularGrid, run } from './helpers';

describe('grid detection', () => {
  it.each([3, 5, 8, 12.5, 16, 32])('finds a regular %s px grid exactly', (cell) => {
    const n = Math.min(120, Math.round(800 / cell));
    const r = run(regularGrid(n, cell));
    expect([r.width, r.height]).toEqual([n, n]);
    expect(r.grid.cell!.x).toBeCloseTo(cell, 0);
  });

  it('recovers the lantern sheet from uneven, noisy, blurred cells', () => {
    const seeds = 40;
    let exact = 0;
    for (let s = 1; s <= seeds; s++) {
      const r = run(fakePixelArt(lanternSheet(), makeRng(s)));
      if (r.width === LANTERN.width && r.height === LANTERN.height) exact++;
      // even when one empty background column is off, the size is within 1
      expect(Math.abs(r.width - LANTERN.width)).toBeLessThanOrEqual(1);
      expect(r.height).toBe(LANTERN.height);
      expect(confidenceLevel(r.grid.confidence)).toBe('high');
    }
    // A blank stretch between frames can be honestly ambiguous: 84 px of flat
    // background is 6 cells of 14 or 5 cells of 16.8, both inside the fake's
    // 14-17 px range, with no edge to tell them apart. A few seeds hit that.
    expect(exact / seeds).toBeGreaterThanOrEqual(0.9);
  });

  it('gets the palette and the frames of the lantern right', () => {
    for (let s = 1; s <= 10; s++) {
      const r = run(fakePixelArt(lanternSheet(), makeRng(s)));
      const colors = new Set<number>();
      for (let i = 0; i < r.pixels.length; i += 4) colors.add((r.pixels[i] << 16) | (r.pixels[i + 1] << 8) | r.pixels[i + 2]);
      expect(colors.size).toBe(LANTERN.colors);
      const frames = findFrames(r.pixels, r.width, r.height, new Set(r.bgKeys), 1);
      expect(frames.length).toBe(LANTERN.frames);
      expect(Math.max(...frames.map((f) => f.w))).toBe(LANTERN.frameWidth);
      expect(Math.max(...frames.map((f) => f.h))).toBe(LANTERN.frameHeight);
    }
  });

  it('honors manual and exact sizes', () => {
    const src = regularGrid(48, 12.5);
    expect(run(src, (o) => { o.size = { ...o.size, mode: 'manual', cellX: 12.5, cellY: 12.5, snap: false }; }).width).toBe(48);
    const exact = run(src, (o) => { o.size = { ...o.size, mode: 'exact', fw: 30, fh: 20 }; });
    expect([exact.width, exact.height]).toEqual([30, 20]);
    const tall = run(src, (o) => { o.size = { ...o.size, mode: 'manual', cellX: 12.5, cellY: 25, snap: false }; });
    expect([tall.width, tall.height]).toEqual([48, 24]);
  });

  it('rejects impossible settings with a readable message', () => {
    const src = regularGrid(10, 8);
    expect(() => run(src, (o) => { o.size = { ...o.size, mode: 'exact', fw: 0 }; })).toThrow(/greater than 0/);
    expect(() => run(src, (o) => { o.size = { ...o.size, mode: 'manual', cellX: 1 }; })).toThrow(/at least 2 px/);
  });
});
